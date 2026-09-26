import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";


test("isolated PostgreSQL manual deductions preserve held quantities during concurrent reservation changes",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const key=randomUUID();const org=await db.organisation.create({data:{name:'Stock atomic CI',slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic'}});
 const user=await db.user.create({data:{organisationId:org.id,name:'Synthetic operator',email:`${key}@example.invalid`}});
 const product=await db.product.create({data:{organisationId:org.id,facilityId:facility.id,sku:key,name:'Synthetic box',category:'BOX',sellingPrice:10,quantityOnHand:5,quantityReserved:4}});
 const output=await build({entryPoints:['src/app/api/v1/operations/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const authErrorResponse=()=>Response.json({error:'synthetic failure'},{status:500});"}));}}]});
 const loaded={exports:{} as {POST:(r:Request)=>Promise<Response>}};
 new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{organisationId:org.id,user:{id:user.id}});
 const send=(type:string,quantity:number)=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',body:JSON.stringify({kind:'stockMovement',payload:{productId:product.id,type,quantity}})}));
 try {
  for(const [type,quantity] of [['SALE',4],['DAMAGE',4],['ADJUSTMENT',-4],['TRANSFER',-4]] as const)assert.equal((await send(type,quantity)).status,409,type);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,5);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),0);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id}}),0);
  assert.equal((await send('SALE',1)).status,201);
  assert.equal((await send('RECEIPT',3)).status,201);
  const original=db.$transaction;const transaction=db.$transaction.bind(db);
  let read!:()=>void,release!:()=>void;
  const wasRead=new Promise<void>(r=>{read=r;});const continueClaim=new Promise<void>(r=>{release=r;});
  db.$transaction=(async(callback:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>transaction(async tx=>callback(new Proxy(tx,{get(target,property){
   if(property==='product')return {...target.product,findFirst:async(input:{where:{id:string;organisationId:string}})=>{const value=await target.product.findFirst(input);read();await continueClaim;return value;}};
   return Reflect.get(target,property);
  }})))) as typeof db.$transaction;
  let response:Response;
  try {
   const pending=send('DAMAGE',2);await wasRead;
   assert.equal(await db.$executeRaw`UPDATE "Product" SET "quantityReserved" = "quantityReserved" + 2 WHERE "id" = ${product.id} AND "quantityOnHand" - "quantityReserved" >= 2`,1);
   release();response=await pending;
  } finally {release();db.$transaction=original;}
  assert.equal(response.status,409);
  const current=await db.product.findUniqueOrThrow({where:{id:product.id}});
  assert.equal(current.quantityOnHand,7);assert.equal(current.quantityReserved,6);
  assert.equal(await db.stockMovement.count({where:{productId:product.id}}),2);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id}}),2);
  await db.product.update({where:{id:product.id},data:{quantityReserved:0}});
  assert.equal((await send('DAMAGE',2)).status,201);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).quantityOnHand,5);
 } finally {await db.$disconnect();}
});
