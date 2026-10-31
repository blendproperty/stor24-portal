import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";
import { createOperationalForm,changeOperationalForm,operationalForms } from "../../src/lib/operational-form-service";
import { formRecordSchema,type FormChange } from "../../src/lib/operational-form-policy";

test("operational form lifecycle, current scope, photo validation and held actions on isolated PostgreSQL",async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  const org = await db.organisation.create({ data:{ name:"Synthetic operational forms",slug:randomUUID() } });
  let auditConstraint=false;
  try {
    const store = await db.facility.create({ data:{ organisationId:org.id,name:"A",code:"A" } }),otherStore = await db.facility.create({ data:{ organisationId:org.id,name:"B",code:"B" } });
    const managerRole = await db.role.create({ data:{ organisationId:org.id,name:"Manager",permissions:["operations.view","operations.manage"] } }),csoRole = await db.role.create({ data:{ organisationId:org.id,name:"CSO",permissions:["operations.view"] } });
    const person = async (name:string,roleId:string,facilityId=store.id) => db.user.create({ data:{ organisationId:org.id,name,email:`${randomUUID()}@example.invalid`,passwordHash:"synthetic-not-a-password",roleAssignments:{ create:{ roleId,facilityId } } } });
    const preparer = await person("Preparer",csoRole.id),reviewer = await person("Reviewer",managerRole.id),other = await person("Other",managerRole.id,otherStore.id);
    const scope = { organisationId:org.id,userId:preparer.id,facilityIds:[store.id],unrestrictedFacilities:false },manager = { ...scope,userId:reviewer.id };
    const input = { facilityId:store.id,kind:"MAINTENANCE",requestKey:randomUUID() };
    const current = (id:string) => db.task.findUniqueOrThrow({ where:{id} });
    const act = async(id:string,actor=scope,patch:Record<string,unknown>={}) => changeOperationalForm(actor,{ id,expectedUpdatedAt:(await current(id)).updatedAt.toISOString(),...patch } as FormChange);
    let id="";
    await t.test("concurrent creation is idempotent and does not alter unrelated operational state",async() => {
      const created = await Promise.all([createOperationalForm(scope,input),createOperationalForm(scope,input)]);id=created[0].id;assert.equal(id,created[1].id);
      assert.equal(await db.task.count({where:{organisationId:org.id}}),1);
      await assert.rejects(createOperationalForm(manager,input),/CONFLICT/);
      await assert.rejects(createOperationalForm(scope,{...input,facilityId:otherStore.id,requestKey:randomUUID()}),/FORBIDDEN/);
    });
    const values={priority:"1",discovered:"2026-10-30",area:"Reception",issue:"Synthetic leak",action:"Inspect and quote",maintenanceReference:"Existing maintenance queue reference"};
    const save = { action:"SAVE",values,photos:[],reviewerId:reviewer.id };
    await t.test("photos are decoded and stripped, changed saves conflict, and another store cannot review",async() => {
      const data=await sharp({create:{width:24,height:24,channels:3,background:"red"}}).jpeg().toBuffer();
      await assert.rejects(act(id,scope,{...save,photos:[{name:"invalid.jpg",data:"data:image/jpeg;base64,AAAA"}]}),/INVALID_PHOTO/);
      await assert.rejects(act(id,scope,{...save,reviewerId:other.id}),/REVIEWER/);
      await act(id,scope,{...save,photos:[{name:"equipment.jpg",data:`data:image/jpeg;base64,${data.toString("base64")}`} ]});
      const stored=await current(id),r=formRecordSchema.parse(stored.operationalForm);assert.equal(r.photos.length,1);assert.ok(r.photos[0].data.startsWith("data:image/jpeg;base64,"));
      const audits=await db.auditEvent.findMany({where:{organisationId:org.id}});assert.equal(JSON.stringify(audits).includes("data:image"),false);
      const stale={id,expectedUpdatedAt:stored.updatedAt.toISOString(),...save} as FormChange;
      const results=await Promise.allSettled([changeOperationalForm(scope,stale),changeOperationalForm(scope,stale)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    });
    await t.test("separate manager reviews and returns, closure stays immutable",async() => {
      await act(id,scope,{...save,action:"SUBMIT"});assert.equal((await current(id)).status,"WAITING");
      await assert.rejects(act(id,scope,{action:"REVIEW",note:"Self review is forbidden"}),/FORBIDDEN/);
      await act(id,manager,{action:"RETURN",note:"Please confirm evidence"});assert.equal((await current(id)).status,"IN_PROGRESS");
      await act(id,scope,{...save,action:"SUBMIT"});await act(id,manager,{action:"REVIEW",note:"Reviewed record; repairs require separate work"});
      assert.equal((await current(id)).status,"COMPLETED");assert.equal(formRecordSchema.parse((await current(id)).operationalForm).reviewedBy,reviewer.id);
      await assert.rejects(act(id,manager,{action:"CANCEL",note:"Cannot rewrite closed evidence"}),/CONFLICT/);
      assert.equal((await operationalForms(manager,{closed:true})).tasks?.length,1);
    });
    await t.test("capture and publication gates cannot be bypassed through the service",async() => {
      for(const kind of ["ATTENDANCE","VISITOR","DEBIT_AUTHORITY"]) await assert.rejects(createOperationalForm(manager,{...input,kind,requestKey:randomUUID()}),/APPROVAL_REQUIRED/);
      for(const kind of ["ADJUDICATION","QUOTATION","LEGAL_1","LEGAL_2","LEGAL_3","EMERGENCY"]) {
        await assert.rejects(createOperationalForm(scope,{...input,kind,requestKey:randomUUID()}),/FORBIDDEN/);
        const draft=await createOperationalForm(manager,{...input,kind,requestKey:randomUUID()});
        await assert.rejects(act(draft.id,manager,{...save,action:"SUBMIT"}),/APPROVAL_REQUIRED/);
        assert.equal((await current(draft.id)).status,"OPEN");
      }
      assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);assert.equal(await db.accessDecision.count({where:{organisationId:org.id}}),0);
    });
    await t.test("detail privacy and current revocation are rechecked",async() => {
      const privateDraft=await createOperationalForm(manager,{...input,kind:"ADJUDICATION",requestKey:randomUUID()});
      await assert.rejects(operationalForms(scope,{id:privateDraft.id}),/NOT_FOUND/);
      assert.equal((await operationalForms(scope,{})).tasks?.some(row=>row.id===privateDraft.id),false);
      await db.role.update({where:{id:csoRole.id},data:{permissions:[]}});
      await assert.rejects(operationalForms(scope,{id}),/NOT_FOUND/);await assert.rejects(createOperationalForm(scope,{...input,requestKey:randomUUID()}),/FORBIDDEN/);
      await db.role.update({where:{id:csoRole.id},data:{permissions:["operations.view"]}});
    });
    await t.test("audit failure rolls back draft changes",async() => {
      const draft=await createOperationalForm(scope,{...input,requestKey:randomUUID()}),before=await current(draft.id);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_form_audit_failure CHECK ("organisationId" <> '${org.id}' OR "action" <> 'operationalForm.save') NOT VALID`);auditConstraint=true;
      await assert.rejects(act(draft.id,scope,save));assert.deepEqual((await current(draft.id)).operationalForm,before.operationalForm);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_form_audit_failure');auditConstraint=false;
    });
    await t.test("actual routes enforce session, MFA, current roles, origin, strict inputs and no-store",async() => {
      const state:{session:{userId:string;sessionVersion:number;mfaVerified:boolean}|null}={session:{userId:preparer.id,sessionVersion:preparer.sessionVersion,mfaVerified:true}};
      const output=await build({entryPoints:["src/app/api/v1/operations/forms/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"real-guards",setup(b){
        b.onResolve({filter:/^(?:@\/lib\/|\.\/)(db|session)$/},a=>({path:a.path,namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("db")?"export const db=__db;":"export const getSession=async()=>__state.session;"}));
      }}]});
      const loaded={exports:{} as Record<"GET"|"POST"|"PATCH",(r:Request)=>Promise<Response>>};new Function("require","module","exports","__db","__state",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,state);
      const send=(body:unknown,origin="https://example.invalid")=>loaded.exports.POST(new Request("https://example.invalid/api",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}));
      assert.equal((await send({...input,requestKey:randomUUID()},"https://attacker.invalid")).status,403);
      assert.equal((await send({...input,facilityId:otherStore.id,requestKey:randomUUID()})).status,403);
      assert.equal((await send({...input,publish:true})).status,422);
      assert.equal((await send({padding:"x".repeat(2000001)})).status,422);
      assert.equal((await send({...input,kind:"VISITOR",requestKey:randomUUID()})).status,422);
      const response=await send({...input,requestKey:randomUUID()});assert.equal(response.status,200);const created=(await response.json()).data.id;
      const read=await loaded.exports.GET(new Request(`https://example.invalid/api?id=${created}`));assert.equal(read.status,200);assert.equal(read.headers.get("cache-control"),"private, no-store");
      state.session!.mfaVerified=false;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,403);state.session!.mfaVerified=true;
      await db.role.update({where:{id:csoRole.id},data:{permissions:[]}});assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,403);await db.role.update({where:{id:csoRole.id},data:{permissions:["operations.view"]}});
      state.session!.sessionVersion++;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,401);state.session=null;assert.equal((await loaded.exports.GET(new Request("https://example.invalid/api"))).status,401);
    });
    await t.test("ordinary task completion cannot bypass form review",async() => {
      const state={session:{userId:reviewer.id,sessionVersion:reviewer.sessionVersion,mfaVerified:true}};
      const output=await build({entryPoints:["src/app/api/v1/operations/tasks/[id]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"real-guards",setup(b){
        b.onResolve({filter:/^(?:@\/lib\/|\.\/)(db|session)$/},a=>({path:a.path,namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("db")?"export const db=__db;":"export const getSession=async()=>__state.session;"}));
      }}]});
      const loaded={exports:{} as {PATCH:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};new Function("require","module","exports","__db","__state",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,state);
      const response=await loaded.exports.PATCH(new Request("https://example.invalid/task",{method:"PATCH",body:JSON.stringify({status:"OPEN"})}),{params:Promise.resolve({id})});assert.equal(response.status,409);assert.equal((await current(id)).status,"COMPLETED");
    });
  } finally {
    if(auditConstraint)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_form_audit_failure');
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.task.deleteMany({where:{organisationId:org.id}});await db.roleAssignment.deleteMany({where:{user:{organisationId:org.id}}});await db.user.deleteMany({where:{organisationId:org.id}});await db.role.deleteMany({where:{organisationId:org.id}});await db.facility.deleteMany({where:{organisationId:org.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});
