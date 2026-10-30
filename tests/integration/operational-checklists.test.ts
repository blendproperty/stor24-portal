import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";
import { createOperationalChecklist, changeOperationalChecklist, operationalChecklists } from "../../src/lib/operational-checklist-service";
import { checklistCreateSchema, checklistRecordSchema, CHECKLIST_PURPOSE, type ChecklistChange } from "../../src/lib/operational-checklist-policy";
import { getOperationsCalendar } from "../../src/lib/calendar-service";

test("isolated PostgreSQL checklist lifecycle, padlock snapshots, permissions and atomic evidence", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  const org=await db.organisation.create({data:{name:"Checklist test",slug:randomUUID()}});let constrained=false;
  try {
    const a=await db.facility.create({data:{organisationId:org.id,name:"A",code:"A"}}),b=await db.facility.create({data:{organisationId:org.id,name:"B",code:"B"}});
    const managerRole=await db.role.create({data:{organisationId:org.id,name:"Manager",permissions:["operations.view","operations.manage"]}}),csoRole=await db.role.create({data:{organisationId:org.id,name:"CSO",permissions:["operations.view"]}});
    const person=async(name:string,roleId:string,facilityId=a.id)=>db.user.create({data:{organisationId:org.id,passwordHash:"synthetic-not-a-real-password-hash",name,email:`${randomUUID()}@example.invalid`,roleAssignments:{create:{roleId,facilityId}}}});
    const manager=await person("Manager",managerRole.id),cso=await person("CSO",csoRole.id),cover=await person("Cover",csoRole.id),other=await person("Other store",managerRole.id,b.id);
    const scope={organisationId:org.id,userId:manager.id,facilityIds:[a.id],unrestrictedFacilities:false},csoScope={...scope,userId:cso.id},coverScope={...scope,userId:cover.id};
    const base=checklistCreateSchema.parse({facilityId:a.id,template:"CLOSING",assigneeId:cso.id,coverId:cover.id,reviewerId:manager.id,startAt:"2026-10-23T06:00:00Z",endAt:"2026-10-23T08:00:00Z",repeat:"DAILY",occurrences:3,requestKey:randomUUID()});
    const current=async(id:string)=>db.task.findUniqueOrThrow({where:{id}});
    const act=async(id:string,actor= csoScope,patch: Record<string, unknown>={action:"START"})=>{const row=await current(id);return changeOperationalChecklist(actor,{id,expectedUpdatedAt:row.updatedAt.toISOString(),...patch} as ChecklistChange);};
    const results=async(id:string)=>{const r=checklistRecordSchema.parse((await current(id)).operationalChecklist);return {rows:r.rows.map(row=>({id:row.id,state:row.expected==="PASS"?"PASS":row.expected==="OCCUPIED"?"OCCUPIED":"VACANT",notes:row.expected==="REVIEW"||row.overlockTask?"Reviewed exception with manager":"",evidence:"Inspection notes",lockCount:row.expected==="PASS"?row.label.includes("trolleys")?2:null:1})),summary:"Inspection completed; findings escalated",comparisonReference:"Rent roll and collections list 23 October"};};
    let id="";
    await t.test("one finite series under concurrent retries, no changed replay, no early completion",async()=>{
      const runs=await Promise.all([createOperationalChecklist(scope,base),createOperationalChecklist(scope,base)]);id=runs[0].id;assert.equal(id,runs[1].id);assert.equal(await db.task.count({where:{organisationId:org.id,purpose:CHECKLIST_PURPOSE}}),3);
      await assert.rejects(createOperationalChecklist(scope,{...base,occurrences:2}),/CONFLICT/);
      await assert.rejects(createOperationalChecklist(csoScope,{...base,requestKey:randomUUID()}),/FORBIDDEN/);
      const future=await createOperationalChecklist(scope,{...base,repeat:"ONCE",occurrences:1,startAt:"2099-01-01T06:00:00Z",endAt:"2099-01-01T08:00:00Z",requestKey:randomUUID()});await assert.rejects(act(future.id),/NOT_DUE/);
    });
    await t.test("assigned preparer and cover save progress, all rows and independent review required",async()=>{
      await assert.rejects(act(id,scope),/FORBIDDEN/);await act(id);
      await assert.rejects(act(id,csoScope,{action:"SUBMIT",...await results(id),rows:[]}),/CONFLICT/);
      const old=await current(id);await act(id,coverScope,{action:"SAVE",...await results(id)});
      await assert.rejects(changeOperationalChecklist(csoScope,{id,expectedUpdatedAt:old.updatedAt.toISOString(),action:"SAVE",...await results(id)} as ChecklistChange),/CONFLICT/);
      const forged=await results(id);forged.rows[0].id="arbitrary";await assert.rejects(act(id,csoScope,{action:"SAVE",...forged}),/CONFLICT/);
      const version=(await current(id)).updatedAt.toISOString(),payload=await results(id);
      const concurrent=await Promise.allSettled([csoScope,coverScope].map(s=>changeOperationalChecklist(s,{id,expectedUpdatedAt:version,action:"SAVE",...payload} as ChecklistChange)));
      assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);assert.equal(concurrent.filter(r=>r.status==="rejected").length,1);
      await act(id,csoScope,{action:"SUBMIT",...await results(id)});assert.equal((await current(id)).status,"WAITING");
      await assert.rejects(act(id,csoScope,{action:"APPROVE",note:"Self approval"}),/FORBIDDEN/);
      await act(id,scope,{action:"RETURN",note:"Please confirm trolley counts"});assert.equal((await current(id)).status,"IN_PROGRESS");
      await act(id,coverScope,{action:"SUBMIT",...await results(id)});await act(id,scope,{action:"APPROVE",note:"Counts and evidence reviewed; no outstanding faults"});
      const done=await current(id);assert.equal(done.status,"COMPLETED");assert.ok(done.completedAt);assert.equal(checklistRecordSchema.parse(done.operationalChecklist).reviewedBy,manager.id);
      await assert.rejects(act(id,scope,{action:"CANCEL"}),/CONFLICT/);assert.equal(await db.task.count({where:{organisationId:org.id,status:"OPEN",startAt:{lt:new Date("2090-01-01")}}}),2);
    });
    await t.test("padlocks use current units, reject inventory drift and retain physical findings without access actions",async()=>{
      const type=await db.unitType.create({data:{facilityId:a.id,name:"5 sqm",areaSqMetres:5}});
      const unit=await db.unit.create({data:{facilityId:a.id,unitTypeId:type.id,number:"01",monthlyRate:100}});
      const parent=await db.unit.create({data:{facilityId:a.id,unitTypeId:type.id,number:"02",monthlyRate:100,status:"UNAVAILABLE"}});
      await db.unit.create({data:{facilityId:a.id,unitTypeId:type.id,number:"old-child",monthlyRate:100,status:"UNAVAILABLE",combinedIntoUnitId:parent.id}});
      const occupied=await db.unit.create({data:{facilityId:a.id,unitTypeId:type.id,number:"04",monthlyRate:100,status:"OCCUPIED"}});
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic customer"}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID()}});
      await db.tenancy.create({data:{facilityId:a.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date(base.startAt),occupancies:{create:{unitId:occupied.id,monthlyRate:100,status:"ACTIVE",startDate:new Date(base.startAt)}}}});
      await db.task.create({data:{organisationId:org.id,facilityId:a.id,unitId:unit.id,purpose:"PHYSICAL_OVERLOCK",title:"Separately approved review reference"}});
      const input={...base,template:"PADLOCK" as const,repeat:"WEEKLY" as const,occurrences:2,requestKey:randomUUID()};const run=await createOperationalChecklist(scope,input);
      assert.equal(checklistRecordSchema.parse((await current(run.id)).operationalChecklist).rows.length,0);await act(run.id);
      const r=checklistRecordSchema.parse((await current(run.id)).operationalChecklist);assert.deepEqual(r.rows.map(r=>r.label),["Unit 01","Unit 02","Unit 04"]);assert.equal(r.rows[0].overlockTask,true);assert.equal(r.rows[1].expected,"REVIEW");assert.equal(r.rows[2].expected,"OCCUPIED");
      await db.unit.update({where:{id:unit.id},data:{number:"03"}});
      await assert.rejects(act(run.id,csoScope,{action:"SUBMIT",...await results(run.id)}),/SOURCE_CHANGED/);await act(run.id,csoScope,{action:"RESTART"});
      const filled=await results(run.id);filled.rows[1].state="OVERLOCKED";filled.rows[1].notes="Physical overlock found; requires review";
      await act(run.id,csoScope,{action:"SUBMIT",...filled});await act(run.id,scope,{action:"APPROVE",note:"Discrepancy retained; manager will investigate"});
      assert.equal(checklistRecordSchema.parse((await current(run.id)).operationalChecklist).rows.filter(r=>r.state==="OVERLOCKED").length,1);
      assert.equal(await db.accessDecision.count({where:{organisationId:org.id}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
      assert.equal((await db.unit.findUniqueOrThrow({where:{id:unit.id}})).status,"AVAILABLE");
      assert.equal(checklistRecordSchema.parse((await db.task.findFirstOrThrow({where:{requestKey:`operational-checklist:${input.requestKey}:1`}})).operationalChecklist).rows.length,0);
    });
    await t.test("current permissions, scope, staff and history pagination are enforced",async()=>{
      await assert.rejects(createOperationalChecklist(scope,{...base,facilityId:b.id,requestKey:randomUUID()}),/FORBIDDEN/);
      await assert.rejects(createOperationalChecklist(scope,{...base,reviewerId:other.id,requestKey:randomUUID()}),/FORBIDDEN/);
      const list=await operationalChecklists(csoScope,{});assert.equal(list.staff.some(u=>u.id===other.id),false);
      await assert.rejects(operationalChecklists({...scope,facilityIds:[b.id]},{id}),/NOT_FOUND/);
      const open=(await db.task.findFirstOrThrow({where:{organisationId:org.id,purpose:CHECKLIST_PURPOSE,status:"OPEN",startAt:{lt:new Date("2090-01-01")}}})).id;
      await db.role.update({where:{id:csoRole.id},data:{permissions:[]}});await assert.rejects(act(open),/FORBIDDEN/);await assert.rejects(operationalChecklists(csoScope,{id:open}),/NOT_FOUND/);
      await db.role.update({where:{id:csoRole.id},data:{permissions:["operations.view"]}});
      await db.role.update({where:{id:managerRole.id},data:{permissions:["operations.view"]}});await assert.rejects(createOperationalChecklist(scope,{...base,requestKey:randomUUID()}),/FORBIDDEN/);await db.role.update({where:{id:managerRole.id},data:{permissions:["operations.view","operations.manage"]}});
      const dates={...base,requestKey:randomUUID(),occurrences:31};await createOperationalChecklist(scope,dates);await createOperationalChecklist(scope,{...dates,requestKey:randomUUID()});
      const first=await operationalChecklists(scope,{});assert.ok(first.nextCursor);const second=await operationalChecklists(scope,{cursor:first.nextCursor!});assert.ok(second.tasks?.length);assert.equal(new Set([...first.tasks!,...second.tasks!].map(t=>t.id)).size,first.tasks!.length+second.tasks!.length);
      assert.ok((await operationalChecklists(scope,{closed:true})).tasks?.some(t=>t.id===id));
      const items=(await getOperationsCalendar(scope,new Date(base.startAt))).flatMap(d=>d.items);assert.ok(items.some(i=>i.href.startsWith("/operations/checklists?id=")));
    });
    await t.test("audit failures roll back both run creation and result changes",async()=>{
      const row=await db.task.findFirstOrThrow({where:{organisationId:org.id,purpose:CHECKLIST_PURPOSE,status:"OPEN",startAt:{lt:new Date("2090-01-01")}}});const count=await db.task.count({where:{organisationId:org.id}});
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_checklist_audit_failure CHECK (false) NOT VALID');constrained=true;
      await assert.rejects(act(row.id));assert.deepEqual(await current(row.id),row);await assert.rejects(createOperationalChecklist(scope,{...base,requestKey:randomUUID()}));assert.equal(await db.task.count({where:{organisationId:org.id}}),count);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_checklist_audit_failure');constrained=false;
    });
    await t.test("actual checklist routes use fresh database role/session/MFA and origin guards",async()=>{
      const state:{session:{userId:string;sessionVersion:number;mfaVerified:boolean}|null}={session:{userId:cso.id,sessionVersion:cso.sessionVersion,mfaVerified:true}};
      const output=await build({entryPoints:["src/app/api/v1/operations/checklists/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"real-guards",setup(b){
        b.onResolve({filter:/^(?:@\/lib\/|\.\/)(db|session)$/},a=>({path:a.path,namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("db")?"export const db=__db;":"export const getSession=async()=>__state.session;"}));
      }}]});
      const loaded={exports:{} as Record<"GET"|"POST"|"PATCH",(r:Request)=>Promise<Response>>};new Function("require","module","exports","__db","__state",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,state);
      const send=(method:"POST"|"PATCH",body:unknown,origin="https://example.invalid")=>loaded.exports[method](new Request("https://example.invalid/api",{method,headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}));
      assert.equal((await send("POST",{...base,requestKey:randomUUID()})).status,403);
      state.session={userId:manager.id,sessionVersion:manager.sessionVersion,mfaVerified:true};
      assert.equal((await send("POST",{...base,requestKey:randomUUID()},"https://attacker.invalid")).status,403);
      assert.equal((await send("POST",{...base,facilityId:b.id,requestKey:randomUUID()})).status,403);
      assert.equal((await send("POST",{...base,requestKey:randomUUID(),occurrences:0})).status,422);
      const response=await send("POST",{...base,repeat:"ONCE",occurrences:1,requestKey:randomUUID()});assert.equal(response.status,200);const created=(await response.json()).data.id;
      state.session={userId:cso.id,sessionVersion:cso.sessionVersion,mfaVerified:true};const row=await current(created);
      assert.equal((await send("PATCH",{id:created,expectedUpdatedAt:row.updatedAt.toISOString(),action:"START"})).status,200);
      const read=await loaded.exports.GET(new Request(`https://example.invalid/api?id=${created}`));assert.equal(read.status,200);assert.equal(read.headers.get("cache-control"),"private, no-store");
      state.session.mfaVerified=false;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,403);state.session.mfaVerified=true;
      await db.role.update({where:{id:csoRole.id},data:{permissions:[]}});assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,403);await db.role.update({where:{id:csoRole.id},data:{permissions:["operations.view"]}});
      state.session.sessionVersion++;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,401);state.session=null;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,401);
    });
    await t.test("ordinary task completion cannot skip checklist review",async()=>{
      const output=await build({entryPoints:["src/app/api/v1/operations/tasks/[id]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"fixture",setup(b){b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const requireSession=async()=>__auth;export const authErrorResponse=()=>Response.json({}, {status:500});"}));}}]});
      const loaded={exports:{} as {PATCH:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{organisationId:org.id,user:{id:manager.id},allowedFacilityIds:[a.id]});
      const response=await loaded.exports.PATCH(new Request('https://example.invalid/task',{method:'PATCH',body:JSON.stringify({status:'OPEN'})}),{params:Promise.resolve({id})});assert.equal(response.status,409);assert.equal((await current(id)).status,"COMPLETED");
    });
  } finally {
    if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_checklist_audit_failure');
    await db.task.deleteMany({where:{organisationId:org.id}});
    await db.occupancy.deleteMany({where:{tenancy:{facility:{organisationId:org.id}}}});
    await db.tenancy.deleteMany({where:{facility:{organisationId:org.id}}});
    await db.account.deleteMany({where:{customer:{organisationId:org.id}}});
    await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});
