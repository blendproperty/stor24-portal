import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {previewCollectionNotice,prepareCollectionNotice,reviewCollectionNotice,sendCollectionNotice} from "../../src/lib/collection-notice-service";
test("isolated collection notices: holds, independent review, source changes and one provider attempt",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="collection-notice-ci-only-encryption-key-at-least-32";process.env.AUTH_SECRET="collection-notice-ci-only-auth-secret-at-least-32";process.env.APP_URL="https://portal.example.invalid";
  const fixture=async(existing?:{org:{id:string};facility:{id:string}})=>{const key=randomUUID(),org=existing?.org??await db.organisation.create({data:{name:"Notice CI",slug:key}}),facility=existing?.facility??await db.facility.create({data:{organisationId:org.id,code:key,name:"CI store"}});
    const users=await Promise.all([0,1].map(i=>db.user.create({data:{organisationId:org.id,name:`Notice CI ${i}`,email:randomUUID()+"@example.invalid"}})));const scopes=users.map(u=>({organisationId:org.id,userId:u.id,facilityIds:[facility.id],unrestrictedFacilities:false}));
    const customer=await db.customer.create({data:{organisationId:org.id,firstName:"CI private",email:key+"@example.invalid",emailVerifiedAt:new Date(),communicationConsent:{email:true}}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:"TEST-"+key,balance:100}});
    await db.tenancy.create({data:{customerId:customer.id,accountId:account.id,facilityId:facility.id,status:"ACTIVE",startDate:new Date("2026-01-01")}});await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:100,description:"CI original",effectiveAt:new Date("2026-01-01")}});
    await db.collectionCase.create({data:{accountId:account.id,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"CI approved due terms",overrides:[]}}});return{org,facility,customer,account,a:scopes[0],b:scopes[1]};};
  const prepared=async(f:Awaited<ReturnType<typeof fixture>>)=>{const p=await previewCollectionNotice(f.a,f.account.id);assert.deepEqual(p.source.blockers,[]);return prepareCollectionNotice(f.a,f.account.id,p.source.fingerprint)};
  const approved=async(f:Awaited<ReturnType<typeof fixture>>)=>{const draft=await prepared(f);return reviewCollectionNotice(f.b,{id:draft.id,revision:draft.revision,action:"approve",reference:"CI independent review"})};
  const nativeFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Real provider network is forbidden")};
  try{
    await t.test("two accounts in the same store and day retain independent drafts and review without sending",async()=>{
      const first=await fixture(),second=await fixture(first),accounts=await db.account.findMany({where:{id:{in:[first.account.id,second.account.id]}},orderBy:{id:'asc'}}),ledger=await db.ledgerEntry.findMany({where:{accountId:{in:[first.account.id,second.account.id]}},orderBy:{id:'asc'}}),payments=await db.payment.count({where:{accountId:{in:[first.account.id,second.account.id]}}}),communications=await db.communicationLog.count({where:{organisationId:first.org.id}});
      const a=await prepared(first),b=await prepared(second);assert.equal(a.asOf,b.asOf);assert.notEqual(a.id,b.id);assert.equal(a.accountId,first.account.id);assert.equal(b.accountId,second.account.id);
      const rows=await db.configurationProfile.findMany({where:{organisationId:first.org.id,facilityId:first.facility.id,domain:'COLLECTION_EMAIL_NOTICE'}});assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.name)).size,2);
      const repeated=await prepared(first);assert.equal(repeated.id,a.id);assert.equal(repeated.revision,a.revision);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.prepared'}}),2);
      await reviewCollectionNotice(first.b,{id:a.id,revision:a.revision,action:'approve',reference:'CI first account review'});const untouched=(await previewCollectionNotice(second.a,second.account.id)).notice;assert.equal(untouched?.status,'DRAFT');assert.equal(untouched?.revision,b.revision);
      assert.deepEqual(await db.account.findMany({where:{id:{in:[first.account.id,second.account.id]}},orderBy:{id:'asc'}}),accounts);assert.deepEqual(await db.ledgerEntry.findMany({where:{accountId:{in:[first.account.id,second.account.id]}},orderBy:{id:'asc'}}),ledger);assert.equal(await db.payment.count({where:{accountId:{in:[first.account.id,second.account.id]}}}),payments);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),communications);
    });
    await t.test("eligibility respects receipt/dispute/contact/consent holds and organisation/facility scope",async()=>{
      const f=await fixture();await db.customer.update({where:{id:f.customer.id},data:{communicationConsent:{email:false}}});assert.ok((await previewCollectionNotice(f.a,f.account.id)).source.blockers.some(v=>v.includes("consent")));
      await db.customer.update({where:{id:f.customer.id},data:{communicationConsent:{email:true},emailVerifiedAt:null}});assert.ok((await previewCollectionNotice(f.a,f.account.id)).source.blockers.some(v=>v.includes("verified")));
      await db.customer.update({where:{id:f.customer.id},data:{emailVerifiedAt:new Date()}});await db.collectionCase.update({where:{accountId:f.account.id},data:{disputed:true}});const held=await previewCollectionNotice(f.a,f.account.id);assert.ok(held.source.blockers.some(v=>v.includes("Dispute")));await assert.rejects(prepareCollectionNotice(f.a,f.account.id,held.source.fingerprint),/COLLECTION_NOTICE_HOLD/);
      await assert.rejects(previewCollectionNotice({...f.a,facilityIds:[]},f.account.id),/COLLECTION_NOT_FOUND/);const other=await fixture();await assert.rejects(previewCollectionNotice(other.a,f.account.id),/COLLECTION_NOT_FOUND/);
      await db.collectionCase.update({where:{accountId:f.account.id},data:{disputed:false}});await db.payment.create({data:{accountId:f.account.id,amount:1,method:"CI",status:"PENDING",environment:"live",idempotencyKey:randomUUID()}});assert.ok((await previewCollectionNotice(f.a,f.account.id)).source.blockers.some(v=>v.includes("awaiting confirmation")));
    });
    await t.test("encrypted drafts and redacted audits; preparers cannot approve; reopening clears approval",async()=>{
      const f=await fixture(),draft=await prepared(f);await assert.rejects(reviewCollectionNotice(f.a,{id:draft.id,revision:draft.revision,action:"approve",reference:"CI self approval"}),/SELF_APPROVAL/);
      const ready=await reviewCollectionNotice(f.b,{id:draft.id,revision:draft.revision,action:"approve",reference:"CI independent"});const row=await db.configurationProfile.findUniqueOrThrow({where:{id:draft.id}}),audits=await db.auditEvent.findMany({where:{organisationId:f.org.id}});
      assert.ok(!JSON.stringify([row,audits]).includes(f.customer.email!));assert.ok(!JSON.stringify([row,audits]).includes(draft.text));
      const reopen=await reviewCollectionNotice(f.a,{id:draft.id,revision:ready.revision,action:"reopen",reference:"CI correction"});assert.equal(reopen.status,"DRAFT");assert.equal(reopen.approvedAt,null);assert.equal(reopen.approvalReference,null);
    });
    await t.test("payment/source or recipient changes invalidate review and stop a provider attempt",async()=>{
      const f=await fixture(),ready=await approved(f);await db.customer.update({where:{id:f.customer.id},data:{email:"changed@example.invalid"}});let calls=0;
      await assert.rejects(sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++}}),/CHANGED/);assert.equal(calls,0);assert.equal((await previewCollectionNotice(f.a,f.account.id)).notice?.sourceCurrent,false);
      assert.equal(await db.communicationLog.count({where:{organisationId:f.org.id}}),0);
    });
    await t.test("overlapping sends and repeat clicks produce one durable attempt and provider acceptance is not delivery",async()=>{
      const f=await fixture(),ready=await approved(f);let calls=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
      const send=sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async message=>{calls++;assert.equal(message.to,f.customer.email);assert.equal(message.dlp?.approvedRecipient,f.customer.email);await held}});
      for(let n=0;n<100&&!calls;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,1);
      const concurrent=await sendCollectionNotice(f.b,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++}});assert.equal(concurrent.status,"SENDING");assert.equal(concurrent.repeated,true);release();const result=await send;assert.equal(result.status,"ACCEPTED");assert.equal(result.deliveryVerified,false);
      const repeated=await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++}});assert.equal(repeated.repeated,true);assert.equal(calls,1);
      const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.equal(log.attempts,1);assert.equal(log.deliveredAt,null);assert.equal(log.nextRetryAt,null);assert.equal(await db.ledgerEntry.count({where:{accountId:f.account.id}}),1);assert.equal((await db.account.findUniqueOrThrow({where:{id:f.account.id}})).balance.toString(),"100");
    });
    await t.test("provider timeout/failure requires review and never permits automatic or manual replay",async()=>{
      const f=await fixture(),ready=await approved(f);let calls=0;const provider={send:async()=>{calls++;throw Error("private provider detail")}};
      const failed=await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},provider);assert.equal(failed.status,"REVIEW_REQUIRED");assert.equal(failed.accepted,false);await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},provider);assert.equal(calls,1);
      const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.equal(log.failureCode,"NOTICE_DELIVERY_REVIEW");assert.ok(!JSON.stringify(log).includes("private provider detail"));await assert.rejects(reviewCollectionNotice(f.a,{id:ready.id,revision:ready.revision,action:"reopen",reference:"CI replay"}),/IMMUTABLE/);
    });
    await t.test("audit failure rolls draft creation back and overlapping preparation cannot overwrite",async()=>{
      const f=await fixture(),p=await previewCollectionNotice(f.a,f.account.id);await assert.rejects(prepareCollectionNotice({...f.a,userId:"CI-missing-actor"},f.account.id,p.source.fingerprint));assert.equal((await previewCollectionNotice(f.a,f.account.id)).notice,null);
      const results=await Promise.allSettled([prepareCollectionNotice(f.a,f.account.id,p.source.fingerprint),prepareCollectionNotice(f.b,f.account.id,p.source.fingerprint)]);assert.ok(results.some(r=>r.status==="fulfilled"));assert.equal(await db.configurationProfile.count({where:{organisationId:f.org.id,domain:"COLLECTION_EMAIL_NOTICE"}}),1);
    });
    await t.test("provider acceptance followed by persistence failure retains a durable no-retry claim",async()=>{
      const f=await fixture(),ready=await approved(f);let calls=0,installed=false;
      try{const result=await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++;await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_notice_completion_failure CHECK (false) NOT VALID');installed=true}});
        assert.equal(result.status,"SENDING");await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++}});assert.equal(calls,1);const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.equal(log.status,"PENDING");assert.equal(log.nextRetryAt,null);
      }finally{if(installed)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_notice_completion_failure')}
    });
  }finally{globalThis.fetch=nativeFetch;await db.$disconnect()}
});
