import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";



test("isolated PostgreSQL keyed stock requests replay once, conflict safely and recover audit rollback",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const key=randomUUID();const org=await db.organisation.create({data:{name:'Stock atomic CI',slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic'}});
 const user=await db.user.create({data:{organisationId:org.id,name:'Synthetic operator',email:`${key}@example.invalid`}});
 const product=await db.product.create({data:{organisationId:org.id,facilityId:facility.id,sku:key,name:'Synthetic box',category:'BOX',sellingPrice:10,quantityOnHand:50}});
 const output=await build({entryPoints:['src/app/api/v1/operations/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const authErrorResponse=()=>Response.json({error:'synthetic failure'},{status:500});"}));}}]});
 const loaded={exports:{} as {POST:(r:Request)=>Promise<Response>}};
 const auth={organisationId:org.id,user:{id:user.id}};
 new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,auth);
 const send=(requestKey:string,quantity=4,type='DAMAGE')=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',headers:{'idempotency-key':requestKey},body:JSON.stringify({kind:'stockMovement',payload:{productId:product.id,type,quantity}})}));
 let constrained=false;
 try {
  const requestKey=randomUUID();
  const responses=await Promise.all(Array.from({length:8},()=>send(requestKey)));
  assert.deepEqual(responses.map(r=>r.status),Array(8).fill(201));
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.equal(new Set(results.map(r=>r.data.id)).size,1);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,46);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),1);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'stockMovement.create'}}),1);
  assert.equal((await send(requestKey,5)).status,409);
  assert.equal((await send(requestKey,4,'SALE')).status,409);
  assert.equal((await send('bad')).status,400);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,46);
  assert.equal((await send(randomUUID())).status,201);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,42);
  const recoveryKey=randomUUID();
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_stock_replay_audit_failure CHECK (false) NOT VALID');constrained=true;
  assert.equal((await send(recoveryKey,3,'RECEIPT')).status,500);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,42);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),2);
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_stock_replay_audit_failure');constrained=false;
  assert.equal((await send(recoveryKey,3,'RECEIPT')).status,201);
  assert.equal((await send(recoveryKey,3,'RECEIPT')).status,201);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,45);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),3);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'stockMovement.create'}}),3);
  const other=await db.user.create({data:{organisationId:org.id,name:'Second synthetic operator',email:randomUUID()+'@example.invalid'}});
  auth.user.id=other.id;
  assert.equal((await send(requestKey)).status,201);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,41);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),4);
 } finally {if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_stock_replay_audit_failure');await db.$disconnect();}
});
