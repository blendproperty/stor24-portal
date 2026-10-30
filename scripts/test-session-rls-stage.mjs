// Real CRM HTTP/session rehearsal against named, disposable databases only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { SignJWT, jwtVerify } from 'jose';

assert.equal(process.env.DB_ROLE_TEST, 'isolated-ci');
assert.ok(process.env.AUTH_SECRET?.startsWith('synthetic-'));
for (const [key,user] of [['MIGRATION_DATABASE_URL','stage_owner'],['TENANT_A_URL','stage_tenant_a'],['TENANT_B_URL','stage_tenant_b'],['AUTH_ROLE_URL','stage_auth']]) {
  const u=new URL(process.env[key]); assert.ok(['postgres:','postgresql:'].includes(u.protocol));
  assert.equal(u.hostname,'localhost'); assert.equal(u.port,'55481'); assert.equal(u.pathname,'/crm_stage_ci'); assert.equal(u.username,user); assert.equal(u.search,'');
}
const owner=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
const dbs=[process.env.TENANT_A_URL,process.env.TENANT_B_URL].map(connectionString=>new pg.Client({connectionString}));
const authDb=new pg.Pool({connectionString:process.env.AUTH_ROLE_URL,max:4});
let router;
const suffix=randomBytes(8).toString('hex');
const orgs=[`stage-org-a-${suffix}`,`stage-org-b-${suffix}`], users=[`stage-user-a-${suffix}`,`stage-user-b-${suffix}`], roles=[`stage-role-a-${suffix}`,`stage-role-b-${suffix}`], customers=[`stage-customer-a-${suffix}`,`stage-customer-b-${suffix}`];
const policies=[`stage_a_${suffix}`,`stage_b_${suffix}`], authView=`stage_auth_users_${suffix}`, tenantAuthFunction=`stage_auth_tenant_${suffix}`, servers=[];
const tenantTokens=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
const tenantHashes=tenantTokens.map(value=>createHash('sha256').update(value).digest('hex'));
const accounts=[`stage-account-a-${suffix}`,`stage-account-b-${suffix}`];
const sameOrgCustomer=`stage-customer-extra-${suffix}`, sameOrgAccount=`stage-account-extra-${suffix}`;
let fixtures=false, enabled=false, granted=false;
const protectedPortalTables=[];
function start(port,url) {
  const env={...process.env,DATABASE_URL:url,NODE_ENV:'production'};
  for(const key of ['MIGRATION_DATABASE_URL','TENANT_A_URL','TENANT_B_URL','BACKUP_ROLE_URL','AUTH_ROLE_URL'])delete env[key];
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});servers.push(child);return child;
}
async function request(port,token,headers={}) { return fetch(`http://127.0.0.1:${port}/api/v1/leasing/customers`,{headers:{...headers,...(token?{cookie:`stor24_session=${token}`}:{})}}); }
async function ready(port,child) {
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('Synthetic CRM server exited');try{if((await request(port)).status===401)return;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
  throw new Error('Synthetic CRM server was not ready');
}
async function token(i,extra={}) {
  return new SignJWT({userId:users[i],name:'Synthetic',email:`stage-${i}-${suffix}@example.invalid`,role:'Synthetic staff',sessionVersion:0,mfaVerified:true,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
}
try {
  await owner.connect();for(const db of dbs)await db.connect();
  for(const table of ['Customer','Account','TenantPortalSession']){
    const state=await owner.query('SELECT relrowsecurity, (SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies FROM pg_class c WHERE oid=$1::regclass',[`public."${table}"`]);
    assert.deepEqual(state.rows,[{relrowsecurity:false,policies:0}],`refuse existing RLS or policies on ${table}`);
  }
  await owner.query('INSERT INTO "Organisation" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now()),($2,$2,$2,now())',orgs);fixtures=true;
  for(let i=0;i<2;i++){
    await owner.query('INSERT INTO "Customer" (id,"organisationId","firstName","updatedAt") VALUES ($1,$2,$3,now())',[customers[i],orgs[i],`Synthetic ${i}`]);
    await owner.query('INSERT INTO "User" (id,"organisationId",email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',[users[i],orgs[i],`stage-${i}-${suffix}@example.invalid`,'Synthetic','synthetic-hash']);
    await owner.query('INSERT INTO "Role" (id,"organisationId",name,permissions,"updatedAt") VALUES ($1,$2,$3,$4,now())',[roles[i],orgs[i],`Synthetic ${i}`,['operations.view']]);
    await owner.query('INSERT INTO "RoleAssignment" (id,"userId","roleId") VALUES ($1,$2,$3)',[`stage-assignment-${i}-${suffix}`,users[i],roles[i]]);
  }
  await owner.query('GRANT USAGE ON SCHEMA public TO stage_tenant_a,stage_tenant_b,stage_auth');
  granted=true;
  await owner.query(`CREATE VIEW \"${authView}\" AS SELECT id,\"organisationId\",active,\"sessionVersion\",(\"passwordHash\" IS NOT NULL) AS password_set FROM \"User\"`);
  await owner.query(`GRANT SELECT ON \"${authView}\" TO stage_auth`);
  await owner.query('BEGIN');
  try {
    await owner.query(`CREATE FUNCTION public.\"${tenantAuthFunction}\"(candidate text) RETURNS TABLE (\"organisationId\" text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT s.\"organisationId\" FROM public.\"TenantPortalSession\" s WHERE s.\"tokenHash\"=candidate AND s.\"revokedAt\" IS NULL AND s.\"expiresAt\">now() $$`);
    await owner.query(`REVOKE ALL ON FUNCTION public.\"${tenantAuthFunction}\"(text) FROM PUBLIC`);
    await owner.query(`GRANT EXECUTE ON FUNCTION public.\"${tenantAuthFunction}\"(text) TO stage_auth`);
    await owner.query('COMMIT');
  } catch(error) { await owner.query('ROLLBACK'); throw error; }
  const publicFunctionGrant=await owner.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS allowed`,[`public.\"${tenantAuthFunction}\"(text)`]);
  assert.equal(publicFunctionGrant.rows[0].allowed,false,'PUBLIC must not execute the privileged lookup');
  const authRole=await owner.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,pg_has_role(rolname,'stage_owner','MEMBER') AS owner_member,(SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships FROM pg_roles r WHERE rolname='stage_auth'");
  assert.deepEqual(Object.values(authRole.rows[0]),[false,false,false,false,false,false,0],'lookup role must not own or administer the database or assume another role');
  await assert.rejects(authDb.query('SELECT \"passwordHash\" FROM \"User\"'),error=>error.code==='42501');
  await assert.rejects(authDb.query('SELECT id FROM \"Customer\"'),error=>error.code==='42501');
  await assert.rejects(authDb.query('SELECT \"tokenHash\" FROM \"TenantPortalSession\"'),error=>error.code==='42501');
  await owner.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO stage_tenant_a,stage_tenant_b');
  await owner.query(`REVOKE ALL ON \"${authView}\" FROM stage_tenant_a,stage_tenant_b`);
  await owner.query('GRANT INSERT ON "AuditEvent" TO stage_tenant_a,stage_tenant_b');
  await owner.query('REVOKE ALL ON "_prisma_migrations" FROM stage_tenant_a,stage_tenant_b');
  for(let i=0;i<2;i++){
    const role=i===0?'stage_tenant_a':'stage_tenant_b';
    await owner.query(`CREATE POLICY "${policies[i]}" ON "Customer" FOR SELECT TO ${role} USING ("organisationId"='${orgs[i]}')`);
  }
  await owner.query('ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY');enabled=true;
  for(const db of dbs){
    await assert.rejects(db.query(`SELECT * FROM public.\"${tenantAuthFunction}\"($1)`,['0'.repeat(64)]),error=>error.code==='42501');
    await assert.rejects(db.query(`SELECT * FROM \"${authView}\"`),error=>error.code==='42501');
  }
  for(const [table,predicate] of [['Account',`EXISTS (SELECT 1 FROM "Customer" c WHERE c.id="Account"."customerId")`],['TenantPortalSession',null]]){
    protectedPortalTables.push(table);
    for(let i=0;i<2;i++){
      const role=i===0?'stage_tenant_a':'stage_tenant_b';
      const condition=predicate ?? `"organisationId"='${orgs[i]}'`;
      await owner.query(`CREATE POLICY "${policies[i]}" ON "${table}" FOR SELECT TO ${role} USING (${condition})`);
    }
    await owner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  }
  const a=start(3101,process.env.TENANT_A_URL),b=start(3102,process.env.TENANT_B_URL);
  await Promise.all([ready(3101,a),ready(3102,b)]);
  router=createServer(async (req,res)=>{
    try {
      if(req.url==='/api/tenant/accounts'){
        const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('stor24_tenant_session='));
        const token=cookie?.slice('stor24_tenant_session='.length);
        if(!token||!/^[a-f0-9]{64}$/.test(token))throw new Error('tenant session');
        const digest=createHash('sha256').update(token).digest('hex');
        const row=(await authDb.query(`SELECT \"organisationId\" FROM public.\"${tenantAuthFunction}\"($1)`,[digest])).rows[0];
        const index=orgs.indexOf(row?.organisationId);if(index<0)throw new Error('tenant routing');
        const downstream=await fetch(`http://127.0.0.1:${3101+index}/api/tenant/accounts`,{headers:{cookie:`stor24_tenant_session=${token}`}});
        const responseHeaders={'content-type':'application/json'};
        for(const name of ['cache-control','x-content-type-options','referrer-policy']){
          const value=downstream.headers.get(name);if(value)responseHeaders[name]=value;
        }
        res.writeHead(downstream.status,responseHeaders);res.end(await downstream.text());return;
      }
      const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('stor24_session='));
      if(!cookie)throw new Error('session');
      const {payload}=await jwtVerify(cookie.slice('stor24_session='.length),new TextEncoder().encode(process.env.AUTH_SECRET),{algorithms:['HS256']});
      if(typeof payload.userId!=='string'||!Number.isInteger(payload.sessionVersion)||payload.mfaVerified!==true)throw new Error('session');
      const row=(await authDb.query(`SELECT \"organisationId\",active,password_set,\"sessionVersion\" FROM \"${authView}\" WHERE id=$1`,[payload.userId])).rows[0];
      if(!row?.active||!row.password_set||row.sessionVersion!==payload.sessionVersion)throw new Error('session');
      const index=orgs.indexOf(row.organisationId);if(index<0)throw new Error('routing');
      const downstream=await request(3101+index,cookie.slice('stor24_session='.length));
      res.writeHead(downstream.status,{'content-type':'application/json'});res.end(await downstream.text());
    } catch { res.writeHead(401,{'cache-control':'private, no-store, max-age=0'});res.end(); }
  });
  await new Promise((resolve,reject)=>router.listen(3100,'127.0.0.1',resolve).once('error',reject));
  const tokens=await Promise.all([token(0),token(1)]);
  for(let i=0;i<2;i++){
    const response=await request(3101+i,tokens[i]);assert.equal(response.status,200);
    assert.deepEqual((await response.json()).data.map(row=>row.id),[customers[i]]);
    const wrong=await request(3102-i,tokens[i]);assert.equal(wrong.status,200);
    assert.deepEqual((await wrong.json()).data,[],'valid session on other database role must not expose its customer');
    const routed=await request(3100,tokens[i]);assert.equal(routed.status,200);assert.deepEqual((await routed.json()).data.map(row=>row.id),[customers[i]],'verified current user selects its organisation role');
  }
  assert.equal((await request(3101,tokens[0]+'bad')).status,401);
  assert.equal((await request(3101,await token(0,{sessionVersion:99}))).status,401);
  assert.ok(!(await request(3101,await token(0,{mfaVerified:false}))).ok,'session without MFA must be denied');
  assert.equal((await request(3101)).status,401);
  assert.equal((await request(3100,tokens[0]+'bad')).status,401);
  assert.equal((await request(3100,await token(0,{sessionVersion:99}))).status,401);
  assert.equal((await request(3100,await token(0,{mfaVerified:false}))).status,401);
  const forgedClaim=await request(3100,await token(0,{organisationId:orgs[1]}));assert.equal(forgedClaim.status,200);assert.deepEqual((await forgedClaim.json()).data.map(row=>row.id),[customers[0]],'routing ignores an organisation claim in the token');
  const forgedHeaders=await request(3100,tokens[0],{'x-organisation-id':orgs[1],'x-forwarded-user':users[1]});
  assert.equal(forgedHeaders.status,200);
  assert.deepEqual((await forgedHeaders.json()).data.map(row=>row.id),[customers[0]],'caller-supplied identity headers must not choose the role');
  assert.equal((await request(3100,await token(0,{userId:`unknown-${suffix}`}))).status,401,'an unknown signed user must not be routed');
  for(let i=0;i<2;i++){
    const email=`tenant-${i}-${suffix}@example.invalid`;
    await owner.query('UPDATE "Customer" SET email=$1,"emailVerifiedAt"=now() WHERE id=$2',[email,customers[i]]);
    await owner.query('INSERT INTO "Account" (id,"customerId","accountNumber","updatedAt") VALUES ($1,$2,$1,now())',[accounts[i],customers[i]]);
    await owner.query('INSERT INTO "TenantPortalSession" ("tokenHash","organisationId",email,"customerIds","expiresAt") VALUES ($1,$2,$3,$4,now()+interval \'10 minutes\')',[tenantHashes[i],orgs[i],email,[customers[i]]]);
  }
  await owner.query('INSERT INTO "Customer" (id,"organisationId",email,"emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,now(),now())',[sameOrgCustomer,orgs[0],`tenant-0-${suffix}@example.invalid`]);
  await owner.query('INSERT INTO "Account" (id,"customerId","accountNumber","updatedAt") VALUES ($1,$2,$1,now())',[sameOrgAccount,sameOrgCustomer]);
  const tenantRequest=(port,session)=>fetch(`http://127.0.0.1:${port}/api/tenant/accounts`,{headers:{cookie:`stor24_tenant_session=${session}`}});
  assert.equal((await authDb.query(`SELECT * FROM public.\"${tenantAuthFunction}\"($1)`,['0'.repeat(64)])).rowCount,0,'unknown hashes do not resolve');
  const malformedTenant=await tenantRequest(3100,'invalid');
  assert.equal(malformedTenant.status,401,'malformed portal tokens cannot be routed');
  assert.match(malformedTenant.headers.get('cache-control')||'',/no-store/,'rejected private responses must not be cached');
  assert.equal((await tenantRequest(3100,'0'.repeat(64))).status,401,'unknown portal tokens cannot be routed');
  for(let i=0;i<2;i++){
    const tenantResponse=await tenantRequest(3101+i,tenantTokens[i]);
    assert.equal(tenantResponse.status,200,'customer session works through its organisation database role');
    assert.deepEqual((await tenantResponse.json()).data.accounts.map(row=>row.id),[accounts[i]],'customer sees only their own account');
    const routedTenant=await tenantRequest(3100,tenantTokens[i]);
    assert.equal(routedTenant.status,200,'the verified customer session selects its organisation role');
    assert.match(routedTenant.headers.get('cache-control')||'',/no-store/,'the router preserves downstream private cache controls');
    assert.equal(routedTenant.headers.get('x-content-type-options'),'nosniff');
    assert.equal(routedTenant.headers.get('referrer-policy'),tenantResponse.headers.get('referrer-policy'),'the router preserves the actual downstream referrer policy');
    assert.deepEqual((await routedTenant.json()).data.accounts.map(row=>row.id),[accounts[i]]);
    assert.deepEqual((await authDb.query(`SELECT * FROM public.\"${tenantAuthFunction}\"($1)`,[tenantHashes[i]])).rows,[{organisationId:orgs[i]}],'the lookup returns only the matching organisation');
    assert.equal((await tenantRequest(3102-i,tenantTokens[i])).status,401,'customer session on the other role cannot read its customer');
    const visibleAccounts=i?[accounts[1]]:[accounts[0],sameOrgAccount].sort();
    assert.deepEqual((await dbs[i].query('SELECT id FROM "Account" WHERE id=ANY($1::text[])',[[...accounts,sameOrgAccount]])).rows.map(row=>row.id).sort(),visibleAccounts,'account RLS is organisation-scoped, while the portal applies customer scope');
    assert.deepEqual((await dbs[i].query('SELECT "tokenHash" FROM "TenantPortalSession" WHERE "tokenHash"=ANY($1::text[])',[tenantHashes])).rows.map(row=>row.tokenHash),[tenantHashes[i]],'session RLS exposes only its own organisation');
    await owner.query('UPDATE "TenantPortalSession" SET "expiresAt"=now()-interval \'1 minute\' WHERE "tokenHash"=$1',[tenantHashes[i]]);
    assert.equal((await authDb.query(`SELECT * FROM public.\"${tenantAuthFunction}\"($1)`,[tenantHashes[i]])).rowCount,0,'expired hashes do not resolve');
    assert.equal((await tenantRequest(3100,tenantTokens[i])).status,401,'expired customer session cannot be routed');
    await owner.query('UPDATE "TenantPortalSession" SET "expiresAt"=now()+interval \'10 minutes\' WHERE "tokenHash"=$1',[tenantHashes[i]]);
    await owner.query('UPDATE "TenantPortalSession" SET "revokedAt"=now() WHERE "tokenHash"=$1',[tenantHashes[i]]);
    assert.equal((await authDb.query(`SELECT * FROM public.\"${tenantAuthFunction}\"($1)`,[tenantHashes[i]])).rowCount,0,'revoked hashes do not resolve');
    assert.equal((await tenantRequest(3101+i,tenantTokens[i])).status,401,'revoked customer session cannot read accounts');
    assert.equal((await tenantRequest(3100,tenantTokens[i])).status,401,'revoked customer session cannot be routed');
  }
  const concurrent=await Promise.all(Array.from({length:20},(_,i)=>request(3100,tokens[i%2])));
  for(let i=0;i<concurrent.length;i++){
    assert.equal(concurrent[i].status,200);
    const expected=i%2?[customers[1]]:[customers[0],sameOrgCustomer].sort();
    assert.deepEqual((await concurrent[i].json()).data.map(row=>row.id).sort(),expected,'concurrent sessions must retain their own database role');
  }
  await owner.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1',[users[0]]);
  assert.equal((await request(3100,tokens[0])).status,401,'session revocation must immediately block routing');
  const renewed=await token(0,{sessionVersion:1});
  assert.deepEqual((await (await request(3100,renewed)).json()).data.map(row=>row.id).sort(),[customers[0],sameOrgCustomer].sort());
  await owner.query('UPDATE "User" SET "organisationId"=$1 WHERE id=$2',[orgs[1],users[0]]);
  await owner.query('UPDATE "RoleAssignment" SET "roleId"=$1 WHERE "userId"=$2',[roles[1],users[0]]);
  const moved=await request(3100,renewed);
  assert.equal(moved.status,200);
  assert.deepEqual((await moved.json()).data.map(row=>row.id),[customers[1]],'routing must use the current user organisation after a move');
  const oldRole=await request(3101,renewed);
  assert.equal(oldRole.status,200);
  assert.deepEqual((await oldRole.json()).data,[],'the application must not expose old-organisation records after the user moves');
  assert.deepEqual((await dbs[0].query('SELECT id FROM "Customer" WHERE id=ANY($1::text[])', [customers])).rows.map(row=>row.id),[customers[0]],'the old role can read only its own organisation');
  assert.deepEqual((await dbs[1].query('SELECT id FROM "Customer" WHERE id=ANY($1::text[])', [customers])).rows.map(row=>row.id),[customers[1]],'the new role can read only its own organisation');
  await owner.query('DELETE FROM "RoleAssignment" WHERE "userId"=$1',[users[0]]);
  assert.equal((await request(3100,renewed)).status,403,'current permission revocation must apply to existing sessions');
  await owner.query('UPDATE "User" SET active=false WHERE id=$1',[users[1]]);
  assert.equal((await request(3100,tokens[1])).status,401,'disabled user must not be routed');
} finally {
  const cleanupErrors=[];
  const clean=async action=>{try{await action();}catch(error){cleanupErrors.push(error);}};
  if(router)await new Promise(resolve=>router.close(resolve));
  for(const child of servers)child.kill('SIGTERM');
  await Promise.all(servers.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,5000).unref();})));
  for(const table of protectedPortalTables){
    await clean(()=>owner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`));
    for(const policy of policies)await clean(()=>owner.query(`DROP POLICY IF EXISTS "${policy}" ON "${table}"`));
  }
  if(enabled)await clean(()=>owner.query('ALTER TABLE "Customer" DISABLE ROW LEVEL SECURITY'));
  for(const policy of policies)await clean(()=>owner.query(`DROP POLICY IF EXISTS "${policy}" ON "Customer"`));
  if(granted)await clean(()=>owner.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM stage_tenant_a,stage_tenant_b'));
  await clean(()=>owner.query(`DROP VIEW IF EXISTS \"${authView}\"`));
  await clean(()=>owner.query(`DROP FUNCTION IF EXISTS public.\"${tenantAuthFunction}\"(text)`));
  if(granted)await clean(()=>owner.query('REVOKE USAGE ON SCHEMA public FROM stage_tenant_a,stage_tenant_b,stage_auth'));
  await clean(()=>owner.query('DELETE FROM "TenantPortalSession" WHERE "tokenHash"=ANY($1::text[])',[tenantHashes]));
  await clean(()=>owner.query('DELETE FROM "Account" WHERE id=ANY($1::text[])',[[...accounts,sameOrgAccount]]));
  if(fixtures)await clean(()=>owner.query('DELETE FROM "Organisation" WHERE id=ANY($1::text[])',[orgs]));
  for(const db of dbs)await clean(()=>db.end());await clean(()=>authDb.end());await clean(()=>owner.end());
  if(cleanupErrors.length)throw new Error(`Synthetic cleanup failed (${cleanupErrors.length} operations)`);
}
console.log(JSON.stringify({crmAuthenticatedRlsRehearsal:'passed',concurrentRequests:20,roleBoundTables:['Customer','Account','TenantPortalSession'],scope:'synthetic sessions and two separately configured local processes',productionIntegrated:false}));
