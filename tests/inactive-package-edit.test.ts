import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
test("inactive package editing preserves its catalogue but activation rejects unavailable products",async()=>{
 const productId="cproduct000000000000000001",facilityId="cfacility00000000000000001";
 let audits=0,writes=0;
 const db={storagePackage:{findFirst:async()=>({id:"pack",facilityId,items:[{productId,quantity:1}]}),update:async()=>{writes++;return {id:"pack"};}},product:{count:async({where}:{where:{active?:boolean}})=>where.active?0:1},storagePackageItem:{deleteMany:async()=>({count:1})},auditEvent:{create:async()=>{audits++;}},$transaction:async(callback:(tx:unknown)=>Promise<unknown>)=>callback(db)};
 const output=await build({entryPoints:["src/app/api/v1/operations/storage-packages/[id]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"package-fixture",setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__db;":"export const requirePermission=async()=>({organisationId:'org',user:{id:'actor'}});export const authErrorResponse=()=>Response.json({error:'blocked'},{status:403});",loader:"js"}));}}]});
 const module={exports:{} as {PATCH:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};
 new Function("module","exports","require","__db",output.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),db);
 const request=(active:boolean)=>new Request("http://localhost/api/v1/operations/storage-packages/pack",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({code:"RETAINED",name:"Retained package",description:"Retained unavailable merchandise",sellingPrice:100,active,items:[{productId,quantity:1}]})});
 const context={params:Promise.resolve({id:"pack"})};
 assert.equal((await module.exports.PATCH(request(false),context)).status,200);assert.equal(writes,1);assert.equal(audits,1);
 assert.equal((await module.exports.PATCH(request(true),context)).status,422);assert.equal(writes,1);assert.equal(audits,1);
});
