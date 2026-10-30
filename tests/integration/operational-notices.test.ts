import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {db} from "../../src/lib/db";
import {Prisma} from "../../src/generated/prisma/client";
import {saveOperationalTemplate,previewOperationalNotice,prepareOperationalNotice,reviewOperationalNotice,sendOperationalNotice,operationalNoticeLibrary} from "../../src/lib/operational-notice-service";
import {noticeStarters} from "../../src/lib/operational-notice-policy";
test("operational notices use immutable templates, exact reviewed audiences and durable guarded delivery",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="operational-notice-ci-only-key-at-least-32";process.env.AUTH_SECRET="operational-notice-ci-auth-secret-at-least-32";
  const key=randomUUID(),org=await db.organisation.create({data:{name:"Synthetic operational notices",slug:key}}),facility=await db.facility.create({data:{organisationId:org.id,code:key,name:"Synthetic store"}}),other=await db.facility.create({data:{organisationId:org.id,code:key+"B",name:"Other store"}});
  const role=await db.role.create({data:{organisationId:org.id,name:"Synthetic notice manager",permissions:["operations.view","operations.manage","billing.documents.send"]}});
  const users=await Promise.all([0,1,2].map(i=>db.user.create({data:{organisationId:org.id,name:`Notice actor ${i}`,email:randomUUID()+"@example.invalid",passwordHash:"synthetic-route-fixture-only",roleAssignments:{create:{facilityId:facility.id,roleId:role.id}}}})));
  const [a,b,c]=users.map(u=>({userId:u.id,organisationId:org.id,facilityIds:[facility.id],unrestrictedFacilities:false}));
  const customers=await Promise.all([0,1,2].map(i=>db.customer.create({data:{organisationId:org.id,firstName:`Synthetic ${i}`,email:`${randomUUID()}@example.invalid`,emailVerifiedAt:new Date(),communicationConsent:{email:true}}})));
  for(const [i,customer] of customers.entries()){const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID()}});await db.tenancy.create({data:{facilityId:i===2?other.id:facility.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date()}});}
  const values={notice_date:"Synthetic 30 October",effective_time:"Synthetic future period",details:"No real closure or maintenance",contact_details:"Synthetic approved contact"};
  let n=0;
  async function fixture(ids=customers.slice(0,2).map(c=>c.id)){
    const template=await saveOperationalTemplate(a,facility.id,{templateId:null,content:{...noticeStarters[2],name:`Synthetic ${++n}`}}),input={templateId:template.id,values,customerIds:ids},preview=await previewOperationalNotice(a,facility.id,input),draft=await prepareOperationalNotice(a,facility.id,{...input,fingerprint:preview.fingerprint});return{template,input,preview,draft};
  }
  const approve=(f:Awaited<ReturnType<typeof fixture>>)=>reviewOperationalNotice(b,facility.id,{id:f.draft.id,revision:f.draft.revision,action:"approve",reference:"Synthetic independent review only"});
  let constraint=false;
  try{
    await t.test("store scope, empty/duplicate audience and consent holds fail closed",async()=>{
      const f=await fixture([customers[0].id]);await assert.rejects(operationalNoticeLibrary(a,other.id),/FORBIDDEN/);await assert.rejects(previewOperationalNotice(a,facility.id,{...f.input,customerIds:[] }));await assert.rejects(previewOperationalNotice(a,facility.id,{...f.input,customerIds:[customers[2].id]}),/NOT_FOUND/);
      await db.customer.update({where:{id:customers[0].id},data:{communicationConsent:{email:true,optedOutAt:new Date().toISOString()}}});await assert.rejects(prepareOperationalNotice(a,facility.id,{...f.input,fingerprint:f.preview.fingerprint}),/CHANGED/);await db.customer.update({where:{id:customers[0].id},data:{communicationConsent:{email:true}}});
    });
    await t.test("template versions are immutable and old approvals cannot send",async()=>{
      const f=await fixture(),approved=await approve(f),next=await saveOperationalTemplate(a,facility.id,{templateId:f.template.id,content:{...noticeStarters[2],name:"Changed version"}});assert.equal(next.version,2);assert.equal((await db.communicationTemplate.findUniqueOrThrow({where:{id:f.template.id}})).body,f.template.body);assert.equal((await db.auditEvent.findFirstOrThrow({where:{entityId:next.id,action:"operational.notice.template_saved"}})).entityType,"CommunicationTemplate");
      await assert.rejects(saveOperationalTemplate(a,facility.id,{templateId:f.template.id,content:noticeStarters[0]}),/CHANGED/);let calls=0;await assert.rejects(sendOperationalNotice(c,facility.id,{id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true},{send:async()=>{calls++}}),/CHANGED/);assert.equal(calls,0);
    });
    await t.test("independent review excludes preparer and every template editor; stale reviews fail",async()=>{
      const f=await fixture();for(const actor of [a])await assert.rejects(reviewOperationalNotice(actor,facility.id,{id:f.draft.id,revision:f.draft.revision,action:"approve",reference:"Must reject self approval"}),/SELF_APPROVAL/);
      const input={...f.input,values:{...values,details:"Another synthetic draft"}},p=await previewOperationalNotice(c,facility.id,input),d=await prepareOperationalNotice(c,facility.id,{...input,fingerprint:p.fingerprint});
      await assert.rejects(reviewOperationalNotice(a,facility.id,{id:d.id,revision:d.revision,action:"approve",reference:"Template editor must not approve"}),/SELF_APPROVAL/);
      await assert.rejects(reviewOperationalNotice(c,facility.id,{id:d.id,revision:d.revision,action:"approve",reference:"Preparer must not approve"}),/SELF_APPROVAL/);
      const approved=await reviewOperationalNotice(b,facility.id,{id:d.id,revision:d.revision,action:"approve",reference:"Synthetic independent review"});assert.equal(approved.status,"APPROVED");
      await assert.rejects(reviewOperationalNotice(b,facility.id,{id:d.id,revision:d.revision,action:"cancel",reference:"Stale version must fail"}),/CHANGED/);
      assert.equal((await prepareOperationalNotice(c,facility.id,{...input,fingerprint:p.fingerprint})).id,d.id);
    });
    await t.test("one exact recipient sends once; retries never call provider; no financial or access writes",async()=>{
      const f=await fixture([customers[0].id]),approved=await approve(f),command={id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true};let calls=0;
      const provider={send:async(message:{to:string;html:string})=>{calls++;assert.equal(message.to,customers[0].email);assert.ok(message.html.includes("No real closure"));}};
      const sent=await sendOperationalNotice(c,facility.id,command,provider);assert.equal(sent.items[0].status,"ACCEPTED");assert.equal(sent.deliveryVerified,false);assert.equal((await sendOperationalNotice(c,facility.id,command,provider)).repeated,true);assert.equal(calls,1);
      assert.equal(await db.communicationLog.count({where:{organisationId:org.id,idempotencyKey:`${approved.id}:${customers[0].id}`}}),1);
      await assert.rejects(sendOperationalNotice(c,facility.id,{...command,customerId:customers[1].id},provider),/NOT_FOUND/);
      assert.equal(await db.ledgerEntry.count({where:{account:{customer:{organisationId:org.id}}}}),0);assert.equal(await db.payment.count({where:{account:{customer:{organisationId:org.id}}}}),0);
    });
    await t.test("concurrent sends allow one provider attempt; uncertainty holds the remaining audience",async()=>{
      const f=await fixture(),approved=await approve(f),command={id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true};let calls=0;
      await Promise.allSettled([0,1].map(()=>sendOperationalNotice(c,facility.id,command,{send:async()=>{calls++;throw Error("Synthetic uncertain provider");}})));assert.equal(calls,1);
      const run=(await operationalNoticeLibrary(a,facility.id)).runs.find(r=>r.id===approved.id)!;assert.equal(run.items.find(i=>i.customerId===customers[0].id)?.status,"REVIEW_REQUIRED");await sendOperationalNotice(c,facility.id,command,{send:async()=>{calls++}});assert.equal(calls,1);
      await assert.rejects(sendOperationalNotice(c,facility.id,{...command,customerId:customers[1].id},{send:async()=>{calls++}}),/CHANGED/);assert.equal(calls,1);
    });
    await t.test("changed destination and revoked approver/sender grants block sends before provider",async()=>{
      const f=await fixture([customers[1].id]),approved=await approve(f),command={id:approved.id,revision:approved.revision,customerId:customers[1].id,confirm:true};let calls=0;const provider={send:async()=>{calls++}};
      await db.customer.update({where:{id:customers[1].id},data:{email:"changed@example.invalid"}});await assert.rejects(sendOperationalNotice(c,facility.id,command,provider),/CHANGED/);await db.customer.update({where:{id:customers[1].id},data:{email:customers[1].email}});
      await db.user.update({where:{id:b.userId},data:{active:false}});await assert.rejects(sendOperationalNotice(c,facility.id,command,provider),/FORBIDDEN/);await db.user.update({where:{id:b.userId},data:{active:true}});
      await db.role.update({where:{id:role.id},data:{permissions:["operations.view"]}});await assert.rejects(sendOperationalNotice(c,facility.id,command,provider),/FORBIDDEN/);await db.role.update({where:{id:role.id},data:{permissions:["operations.view","operations.manage","billing.documents.send"]}});assert.equal(calls,0);
    });
    await t.test("audit failure rolls back a durable send claim before provider call",async()=>{
      const f=await fixture([customers[0].id]),approved=await approve(f);let calls=0;
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_operational_notice_audit CHECK ("entityId" <> '${approved.id}' OR action <> 'operational.notice.send_claimed')`);constraint=true;
      await assert.rejects(sendOperationalNotice(c,facility.id,{id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true},{send:async()=>{calls++}}));assert.equal(calls,0);assert.equal(await db.communicationLog.count({where:{idempotencyKey:`${approved.id}:${customers[0].id}`}}),0);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_operational_notice_audit');constraint=false;
    });
    await t.test("acceptance persistence failure retains SENDING and prevents any replay",async()=>{
      const f=await fixture([customers[0].id]),approved=await approve(f),command={id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true};let calls=0;
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_operational_notice_audit CHECK ("entityId" <> '${approved.id}' OR action <> 'operational.notice.delivery_outcome')`);constraint=true;
      const provider={send:async()=>{calls++}},result=await sendOperationalNotice(c,facility.id,command,provider);assert.equal(result.items[0].status,"SENDING");assert.equal((await sendOperationalNotice(c,facility.id,command,provider)).repeated,true);assert.equal(calls,1);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_operational_notice_audit');constraint=false;
    });
    await t.test("partial delivery can cancel remaining recipients without recalling accepted outcomes",async()=>{
      const f=await fixture(),approved=await approve(f);let calls=0;const provider={send:async()=>{calls++}};
      const sent=await sendOperationalNotice(c,facility.id,{id:approved.id,revision:approved.revision,customerId:customers[0].id,confirm:true},provider);assert.equal(sent.status,"DISPATCHING");
      const cancelled=await reviewOperationalNotice(b,facility.id,{id:sent.id,revision:sent.revision,action:"cancel",reference:"Synthetic cancel remaining audience"});assert.equal(cancelled.status,"CANCELLED");assert.equal(cancelled.items.find(i=>i.customerId===customers[0].id)?.status,"ACCEPTED");
      await assert.rejects(sendOperationalNotice(c,facility.id,{id:cancelled.id,revision:cancelled.revision,customerId:customers[1].id,confirm:true},provider),/CHANGED/);assert.equal(calls,1);
    });
    await t.test("actual HTTP route checks origin, session, MFA, bounded input and fresh roles",async()=>{
      const hooks:{session:{userId:string;organisationId:string;sessionVersion:number;mfaVerified:boolean}|null}={session:{userId:a.userId,organisationId:org.id,sessionVersion:0,mfaVerified:true}};
      const result=await build({entryPoints:["src/app/api/v1/communications/operational-notices/route.ts"],bundle:true,write:false,format:"cjs",platform:"node",packages:"external",plugins:[{name:"notice-http",setup(b){b.onResolve({filter:/^(?:@\/lib\/db|\.\/db)$/},()=>({path:"db",namespace:"fixture"}));b.onResolve({filter:/^(?:@\/lib\/session|\.\/session)$/},()=>({path:"session",namespace:"fixture"}));b.onResolve({filter:/generated\/prisma\/client$/},()=>({path:"prisma",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="db"?"export const db=__db;":args.path==="prisma"?"export const Prisma=__Prisma;":"export async function getSession(){return __hooks.session;}"}));}}]});
      const loaded={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};new Function("require","module","exports","__db","__hooks","__Prisma",result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,hooks,Prisma);
      const get=()=>loaded.exports.GET(new Request(`https://fixture.invalid/api/v1/communications/operational-notices?facilityId=${facility.id}`)),post=(body:unknown,origin="https://fixture.invalid")=>loaded.exports.POST(new Request("https://fixture.invalid/api/v1/communications/operational-notices",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}));
      const response=await get();assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal((await post({},"https://foreign.invalid")).status,403);assert.equal((await post(null)).status,400);hooks.session!.mfaVerified=false;assert.equal((await get()).status,403);hooks.session!.mfaVerified=true;await db.role.update({where:{id:role.id},data:{permissions:[]}});assert.equal((await get()).status,403);hooks.session=null;assert.equal((await get()).status,401);
    });
  }finally{if(constraint)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_operational_notice_audit');await db.tenancy.deleteMany({where:{facilityId:{in:[facility.id,other.id]}}});await db.account.deleteMany({where:{customer:{organisationId:org.id}}});await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.organisation.delete({where:{id:org.id}});assert.equal(await db.customer.count({where:{organisationId:org.id}}),0);await db.$disconnect();}
});
