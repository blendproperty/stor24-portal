// Real CRM HTTP/session rehearsal against named, disposable databases only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
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
const authDb=new pg.Client({connectionString:process.env.AUTH_ROLE_URL});
let router;
const suffix=randomBytes(8).toString('hex');
const orgs=[`stage-org-a-${suffix}`,`stage-org-b-${suffix}`], users=[`stage-user-a-${suffix}`,`stage-user-b-${suffix}`], roles=[`stage-role-a-${suffix}`,`stage-role-b-${suffix}`], customers=[`stage-customer-a-${suffix}`,`stage-customer-b-${suffix}`];
const policies=[`stage_a_${suffix}`,`stage_b_${suffix}`], authView=`stage_auth_users_${suffix}`, servers=[];
let fixtures=false, enabled=false;
function start(port,url) {
  const env={...process.env,DATABASE_URL:url,NODE_ENV:'production'};
  for(const key of ['MIGRATION_DATABASE_URL','TENANT_A_URL','TENANT_B_URL','BACKUP_ROLE_URL','AUTH_ROLE_URL'])delete env[key];
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});servers.push(child);return child;
}
async function request(port,token) { return fetch(`http://127.0.0.1:${port}/api/v1/leasing/customers`,{headers:token?{cookie:`stor24_session=${token}`}:{}}); }
async function ready(port,child) {
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('Synthetic CRM server exited');try{if((await request(port)).status===401)return;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
  throw new Error('Synthetic CRM server was not ready');
}
async function token(i,extra={}) {
  return new SignJWT({userId:users[i],name:'Synthetic',email:`stage-${i}-${suffix}@example.invalid`,role:'Synthetic staff',sessionVersion:0,mfaVerified:true,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
}
try {
  await owner.connect();for(const db of dbs)await db.connect();await authDb.connect();
  assert.equal((await owner.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public."Customer"'::regclass`)).rows[0].relrowsecurity,false);
  await owner.query('INSERT INTO "Organisation" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now()),($2,$2,$2,now())',orgs);fixtures=true;
  for(let i=0;i<2;i++){
    await owner.query('INSERT INTO "Customer" (id,"organisationId","firstName","updatedAt") VALUES ($1,$2,$3,now())',[customers[i],orgs[i],`Synthetic ${i}`]);
    await owner.query('INSERT INTO "User" (id,"organisationId",email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',[users[i],orgs[i],`stage-${i}-${suffix}@example.invalid`,'Synthetic','synthetic-hash']);
    await owner.query('INSERT INTO "Role" (id,"organisationId",name,permissions,"updatedAt") VALUES ($1,$2,$3,$4,now())',[roles[i],orgs[i],`Synthetic ${i}`,['operations.view']]);
    await owner.query('INSERT INTO "RoleAssignment" (id,"userId","roleId") VALUES ($1,$2,$3)',[`stage-assignment-${i}-${suffix}`,users[i],roles[i]]);
  }
  await owner.query('GRANT USAGE ON SCHEMA public TO stage_tenant_a,stage_tenant_b,stage_auth');
  await owner.query(`CREATE VIEW \"${authView}\" AS SELECT id,\"organisationId\",active,\"sessionVersion\",(\"passwordHash\" IS NOT NULL) AS password_set FROM \"User\"`);
  await owner.query(`GRANT SELECT ON \"${authView}\" TO stage_auth`);
  await assert.rejects(authDb.query('SELECT \"passwordHash\" FROM \"User\"'),error=>error.code==='42501');
  await assert.rejects(authDb.query('SELECT id FROM \"Customer\"'),error=>error.code==='42501');
  await owner.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO stage_tenant_a,stage_tenant_b');
  await owner.query('REVOKE ALL ON "_prisma_migrations" FROM stage_tenant_a,stage_tenant_b');
  for(let i=0;i<2;i++){
    const role=i===0?'stage_tenant_a':'stage_tenant_b';
    await owner.query(`CREATE POLICY "${policies[i]}" ON "Customer" FOR SELECT TO ${role} USING ("organisationId"='${orgs[i]}')`);
  }
  await owner.query('ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY');enabled=true;
  const a=start(3101,process.env.TENANT_A_URL),b=start(3102,process.env.TENANT_B_URL);
  await Promise.all([ready(3101,a),ready(3102,b)]);
  router=createServer(async (req,res)=>{
    try {
      const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('stor24_session='));
      if(!cookie)throw new Error('session');
      const {payload}=await jwtVerify(cookie.slice('stor24_session='.length),new TextEncoder().encode(process.env.AUTH_SECRET),{algorithms:['HS256']});
      if(typeof payload.userId!=='string'||!Number.isInteger(payload.sessionVersion)||payload.mfaVerified!==true)throw new Error('session');
      const row=(await authDb.query(`SELECT \"organisationId\",active,password_set,\"sessionVersion\" FROM \"${authView}\" WHERE id=$1`,[payload.userId])).rows[0];
      if(!row?.active||!row.password_set||row.sessionVersion!==payload.sessionVersion)throw new Error('session');
      const index=orgs.indexOf(row.organisationId);if(index<0)throw new Error('routing');
      const downstream=await request(3101+index,cookie.slice('stor24_session='.length));
      res.writeHead(downstream.status,{'content-type':'application/json'});res.end(await downstream.text());
    } catch { res.writeHead(401);res.end(); }
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
  await owner.query('DELETE FROM "RoleAssignment" WHERE "userId"=$1',[users[0]]);
  assert.equal((await request(3100,tokens[0])).status,403,'current permission revocation must apply to existing sessions');
  await owner.query('UPDATE "User" SET active=false WHERE id=$1',[users[1]]);
  assert.equal((await request(3100,tokens[1])).status,401,'disabled user must not be routed');
  console.log(JSON.stringify({crmAuthenticatedRlsHttpChecks:16,scope:'synthetic sessions and two separately configured local processes',productionIntegrated:false}));
} finally {
  if(router)await new Promise(resolve=>router.close(resolve));
  for(const child of servers)child.kill('SIGTERM');
  await Promise.all(servers.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,5000).unref();})));
  if(enabled)await owner.query('ALTER TABLE "Customer" DISABLE ROW LEVEL SECURITY');
  for(const policy of policies)await owner.query(`DROP POLICY IF EXISTS "${policy}" ON "Customer"`).catch(()=>{});
  await owner.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM stage_tenant_a,stage_tenant_b').catch(()=>{});
  await owner.query(`DROP VIEW IF EXISTS \"${authView}\"`).catch(()=>{});
  await owner.query('REVOKE USAGE ON SCHEMA public FROM stage_tenant_a,stage_tenant_b,stage_auth').catch(()=>{});
  if(fixtures)await owner.query('DELETE FROM "Organisation" WHERE id=ANY($1::text[])',[orgs]);
  for(const db of dbs)await db.end().catch(()=>{});await authDb.end().catch(()=>{});await owner.end().catch(()=>{});
}
