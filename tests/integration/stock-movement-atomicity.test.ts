import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";


test("isolated PostgreSQL stock claims prevent negative stock and roll back failed audits",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const key=randomUUID();const org=await db.organisation.create({data:{name:'Stock atomic CI',slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic'}});
 const user=await db.user.create({data:{organisationId:org.id,name:'Synthetic operator',email:`${key}@example.invalid`}});
 const product=await db.product.create({data:{organisationId:org.id,facilityId:facility.id,sku:key,name:'Synthetic box',category:'BOX',sellingPrice:10,quantityOnHand:5}});
 const output=await build({entryPoints:['src/app/api/v1/operations/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const authErrorResponse=()=>Response.json({error:'synthetic failure'},{status:500});"}));}}]});
 const loaded={exports:{} as {POST:(r:Request)=>Promise<Response>}};
 new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{organisationId:org.id,user:{id:user.id}});
 const send=(type:string,quantity:number)=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',body:JSON.stringify({kind:'stockMovement',payload:{productId:product.id,type,quantity}})}));
 let constrained=false;
 try{
  const original=db.$transaction;
  const transaction=db.$transaction.bind(db);
  let arrivals=0, release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  db.$transaction=(async(callback:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>transaction(async tx=>callback(new Proxy(tx,{get(target,property){
   if(property==='product')return {...target.product,findFirst:async(input:{where:{id:string;organisationId:string}})=>{
    const value=await target.product.findFirst(input);arrivals++;if(arrivals===2)release();await barrier;return value;
   }};
   return Reflect.get(target,property);
  }})))) as typeof db.$transaction;
  let results:Response[];
  try{results=await Promise.all([send('DAMAGE',4),send('DAMAGE',4)]);}finally{db.$transaction=original;}
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,1);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),1);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'stockMovement.create'}}),1);
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_stock_audit_failure CHECK (false) NOT VALID');constrained=true;
  const before=await db.product.findUniqueOrThrow({where:{id:product.id}});
  assert.equal((await send('RECEIPT',3)).status,500);
  assert.deepEqual(await db.product.findUniqueOrThrow({where:{id:product.id}}),before);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),1);
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_stock_audit_failure');constrained=false;
  assert.equal((await send('RECEIPT',3)).status,201);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,4);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),2);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'stockMovement.create'}}),2);
 }finally{if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_stock_audit_failure');await db.$disconnect();}
});
