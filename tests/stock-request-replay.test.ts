import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("keyed stock replay rolls back and rejects changed details without repeating writes", async () => {
 const state={quantity:5,movements:[] as Array<Record<string, unknown>>,audits:[] as unknown[],failAudit:true};
 const client=(s:typeof state)=>({$executeRaw:async()=>1,product:{
  findFirst:async()=>({id:'cmstockproduct0000000000001',facilityId:'facility',quantityOnHand:s.quantity,quantityReserved:0}),
  update:async({data}:{data:{quantityOnHand:{increment:number}}})=>{s.quantity+=data.quantityOnHand.increment;},
  updateMany:async({where,data}:{where:{quantityOnHand?:{gte:number}};data:{quantityOnHand:{increment:number}}})=>{if(where.quantityOnHand&&s.quantity<where.quantityOnHand.gte)return {count:0};s.quantity+=data.quantityOnHand.increment;return {count:1};},
 },stockMovement:{findUnique:async({where}:{where:{idempotencyKey:string}})=>s.movements.find(row=>row.idempotencyKey===where.idempotencyKey)??null,create:async({data}:{data:unknown})=>{const row={id:'movement',...(data as object)};s.movements.push(row);return row;}},auditEvent:{create:async({data}:{data:unknown})=>{if(state.failAudit)throw Error('AUDIT_FAILURE');s.audits.push(data);return data;}}});
 const database={...client(state),$transaction:async(fn:(tx:ReturnType<typeof client>)=>Promise<unknown>)=>{const pending=structuredClone(state);const result=await fn(client(pending));Object.assign(state,pending);return result;}};
 const output=await build({entryPoints:['src/app/api/v1/operations/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>({organisationId:'org',user:{id:'actor'}});export const authErrorResponse=e=>Response.json({error:e.message},{status:500});"}));}}]});
 const loaded={exports:{} as {POST:(r:Request)=>Promise<Response>}};
 new Function('require','module','exports','__db',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,database);
 const send=(quantity=4,key='synthetic-request-key-0001')=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({kind:'stockMovement',payload:{productId:'cmstockproduct0000000000001',type:'DAMAGE',quantity}})}));
 assert.equal((await send()).status,500);assert.equal(state.quantity,5);assert.equal(state.movements.length,0);
 state.failAudit=false;const first=await send();assert.equal(first.status,201);const firstBody=await first.json();
 const retry=await send();assert.equal(retry.status,201);assert.equal((await retry.json()).data.id,firstBody.data.id);
 assert.equal(state.quantity,1);assert.equal(state.movements.length,1);assert.equal(state.audits.length,1);
 assert.equal((await send(3)).status,409);assert.equal(state.quantity,1);
 assert.equal((await send(1,'bad')).status,400);assert.equal(state.quantity,1);
 assert.equal((await send(1,'synthetic-request-key-0002')).status,201);assert.equal(state.quantity,0);assert.equal(state.movements.length,2);
});
