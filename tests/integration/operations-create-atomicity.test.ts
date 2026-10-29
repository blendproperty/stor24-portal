import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";


test('isolated PostgreSQL operations creation and audit commit together',async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const key=randomUUID();const org=await db.organisation.create({data:{name:'Operations atomic CI',slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic'}});
 const user=await db.user.create({data:{organisationId:org.id,name:'Synthetic operator',email:`${key}@example.invalid`}});
 const type=await db.unitType.create({data:{facilityId:facility.id,name:'Synthetic',features:[]}});
 const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:'SYN',monthlyRate:1}});
 const product=await db.product.create({data:{organisationId:org.id,facilityId:facility.id,sku:'SEED',name:'Synthetic box',category:'BOX',sellingPrice:2}});
 const output=await build({entryPoints:['src/app/api/v1/operations/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const requireSession=async()=>__auth;export const authErrorResponse=e=>Response.json({error:'synthetic failure'},{status:e.message==='FORBIDDEN'?403:500});"}));}}]});
 const loaded={exports:{} as {POST:(r:Request)=>Promise<Response>}};
 new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{organisationId:org.id,allowedFacilityIds:null,user:{id:user.id}});
 const cases=[
  {kind:'task',payload:{title:'Synthetic task'},count:()=>db.task.count({where:{organisationId:org.id}})},
  {kind:'unitNote',payload:{facilityId:facility.id,unitId:unit.id,note:'Synthetic note'},count:()=>db.unitNote.count({where:{organisationId:org.id}})},
  {kind:'product',payload:{facilityId:facility.id,sku:'NEW',name:'Synthetic product',category:'BOX',costPrice:1,sellingPrice:2},count:()=>db.product.count({where:{organisationId:org.id,sku:'NEW'}})},
  {kind:'storagePackage',payload:{facilityId:facility.id,code:'PACK',name:'Synthetic package',description:'Synthetic package description',sellingPrice:2,items:[{productId:product.id,quantity:1}]},count:()=>db.storagePackage.count({where:{organisationId:org.id}})},
 ];
 let constrained=false;
 try{for(const c of cases){
  const send=()=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',body:JSON.stringify({kind:c.kind,payload:c.payload})}));
  const audits=await db.auditEvent.count({where:{organisationId:org.id}});
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_operations_create_audit_failure CHECK (false) NOT VALID');constrained=true;
  assert.equal((await send()).status,500);assert.equal(await c.count(),0,c.kind);assert.equal(await db.auditEvent.count({where:{organisationId:org.id}}),audits);
  if(c.kind==='storagePackage')assert.equal(await db.storagePackageItem.count({where:{productId:product.id}}),0);
  await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_operations_create_audit_failure');constrained=false;
  const response=await send();assert.equal(response.status,201);assert.equal(await c.count(),1);
  const data=(await response.json()).data;
  const audit=await db.auditEvent.findFirstOrThrow({where:{organisationId:org.id,entityId:data.id}});
  assert.equal(audit.action,`${c.kind}.create`);assert.equal(audit.actorId,user.id);assert.deepEqual(audit.after,data);
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id}}),audits+1);
 }
 const foreignOrg=await db.organisation.create({data:{name:'Other synthetic org',slug:randomUUID()}});
 const foreignUser=await db.user.create({data:{organisationId:foreignOrg.id,name:'Foreign synthetic user',email:`${randomUUID()}@example.invalid`}});
 const before=await db.task.count({where:{organisationId:org.id}});
 const invalid=await loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',body:JSON.stringify({kind:'task',payload:{facilityId:facility.id,assigneeId:foreignUser.id,title:'Synthetic foreign assignee'}})}));
 assert.equal(invalid.status,403);assert.equal(await db.task.count({where:{organisationId:org.id}}),before,'foreign relationships must not be inserted');
 const staff=await db.user.create({data:{organisationId:org.id,name:'Scoped synthetic staff',email:`${randomUUID()}@example.invalid`}});
 const role=await db.role.create({data:{organisationId:org.id,name:`Synthetic ${key}`,permissions:['operations.view']}});
 await db.roleAssignment.create({data:{userId:staff.id,roleId:role.id,facilityId:facility.id}});
 const assign=(facilityId?:string)=>loaded.exports.POST(new Request('https://example.invalid/operations',{method:'POST',body:JSON.stringify({kind:'task',payload:{facilityId,assigneeId:staff.id,title:'Synthetic assigned task'}})}));
 assert.equal((await assign()).status,403,'facility-scoped staff cannot receive invisible portfolio tasks');
 assert.equal((await assign(facility.id)).status,201,'visible facility assignment stays available');
 await db.roleAssignment.deleteMany({where:{userId:staff.id}});
 await db.roleAssignment.create({data:{userId:staff.id,roleId:role.id,facilityId:null}});
 assert.equal((await assign()).status,201,'organisation-wide assignees can receive portfolio tasks');
 await db.user.delete({where:{id:foreignUser.id}});await db.organisation.delete({where:{id:foreignOrg.id}});
 }finally{if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_operations_create_audit_failure');await db.$disconnect();}
});
