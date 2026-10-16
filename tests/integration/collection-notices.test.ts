import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import { customerHistory } from "../../src/lib/customer-history-service";
import { historyQuerySchema } from "../../src/lib/customer-history-policy";
import { buildCustomerHistoryExport, hydrateCustomerHistoryMessages } from "../../src/lib/customer-history-export";
import { customerHistoryPdf } from "../../src/lib/customer-history-document";
import { customerHistoryExcel } from "../../src/lib/customer-history-excel";
import { toCsv } from "../../src/lib/reporting";
import { communicationLogPage } from "../../src/lib/communication-log-service";
import { communicationFiltersSchema } from "../../src/lib/communication-log-query";
import { historyEvidence } from "../../src/lib/customer-history-message-policy";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";

import {previewCollectionNotice,prepareCollectionNotice,reviewCollectionNotice,sendCollectionNotice,previewCollectionNoticeBatch,prepareCollectionNoticeBatch,approveCollectionNoticeBatch} from "../../src/lib/collection-notice-service";
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
    await t.test("independent audience approval is atomic, revision-bound and changes no money or communications",async()=>{
      const first=await fixture(),second=await fixture(first),ids=[first.account.id,second.account.id],beforeAccounts=await db.account.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),beforeLedger=await db.ledgerEntry.findMany({where:{accountId:{in:ids}},orderBy:{id:'asc'}});
      const preview=await previewCollectionNoticeBatch(first.a,ids),drafts=await prepareCollectionNoticeBatch(first.a,{items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true});
      const command={items:drafts.notices.map(notice=>({accountId:notice.accountId,id:notice.id,revision:notice.revision})),reference:'CI independent audience review',confirm:true};
      await assert.rejects(approveCollectionNoticeBatch(first.a,command),/SELF_APPROVAL/);
      const result=await approveCollectionNoticeBatch(first.b,command);assert.equal(result.approved,true);assert.equal(result.emailSent,false);assert.ok(result.notices.every(notice=>notice.status==='APPROVED'&&notice.sourceCurrent&&!notice.canApprove));
      assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.approve',actorId:first.b.userId}}),2);
      await assert.rejects(approveCollectionNoticeBatch(first.b,command),/CHANGED|IMMUTABLE/);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.approve'}}),2);
      assert.deepEqual(await db.account.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),beforeAccounts);assert.deepEqual(await db.ledgerEntry.findMany({where:{accountId:{in:ids}},orderBy:{id:'asc'}}),beforeLedger);assert.equal(await db.payment.count({where:{accountId:{in:ids}}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
    });
    await t.test("late consent, revision, identity, contributor and scope holds roll back all group approvals",async()=>{
      for(const hold of ['consent','revision','identity','contributor','scope']){
        const first=await fixture(),second=await fixture(first),ids=[first.account.id,second.account.id].sort(),last=ids.at(-1)===first.account.id?first:second;
        const preview=await previewCollectionNoticeBatch(first.a,ids),drafts=await prepareCollectionNoticeBatch(first.a,{items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true});
        const command={items:drafts.notices.map(notice=>({accountId:notice.accountId,id:notice.id,revision:notice.revision})),reference:'CI held review',confirm:true};
        if(hold==='consent')await db.customer.update({where:{id:last.customer.id},data:{communicationConsent:{email:false}}});
        if(hold==='revision')command.items.at(-1)!.revision=randomUUID();
        if(hold==='identity'){const item=command.items.at(-1)!;item.accountId='unmatched-account';}
        if(hold==='contributor'){const item=command.items.at(-1)!,row=await db.configurationProfile.findUniqueOrThrow({where:{id:item.id}});await db.configurationProfile.update({where:{id:item.id},data:{config:{...(row.config as object),contributors:[first.a.userId,first.b.userId]}}});}
        const baseline=await db.configurationProfile.findMany({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'},orderBy:{id:'asc'}});
        await assert.rejects(approveCollectionNoticeBatch(hold==='scope'?{...first.b,facilityIds:[]}:first.b,command),/CHANGED|SELF_APPROVAL|NOT_FOUND/);
        assert.deepEqual(await db.configurationProfile.findMany({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'},orderBy:{id:'asc'}}),baseline);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.approve'}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
      }
    });
    await t.test("overlapping group approval records one approval per notice without replay",async()=>{
      const first=await fixture(),second=await fixture(first),preview=await previewCollectionNoticeBatch(first.a,[first.account.id,second.account.id]),drafts=await prepareCollectionNoticeBatch(first.a,{items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true}),command={items:drafts.notices.map(notice=>({accountId:notice.accountId,id:notice.id,revision:notice.revision})),reference:'CI overlapping review',confirm:true};
      const results=await Promise.allSettled([approveCollectionNoticeBatch(first.b,command),approveCollectionNoticeBatch(first.b,command)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.approve'}}),2);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
    });
    await t.test("group approval audit failure rolls back every approval revision",async()=>{
      const first=await fixture(),second=await fixture(first),preview=await previewCollectionNoticeBatch(first.a,[first.account.id,second.account.id]),drafts=await prepareCollectionNoticeBatch(first.a,{items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true}),command={items:drafts.notices.map(notice=>({accountId:notice.accountId,id:notice.id,revision:notice.revision})),reference:'CI audit rollback',confirm:true};
      const baseline=await db.configurationProfile.findMany({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'},orderBy:{id:'asc'}});let installed=false;
      const last=command.items.toSorted((a,b)=>a.accountId.localeCompare(b.accountId)).at(-1)!;assert.match(last.id,/^collection-email:[a-f0-9]{64}$/);
      try{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_audience_approval_failure CHECK ("action" <> 'collection.notice.approve' OR "entityId" <> '${last.id}') NOT VALID`);installed=true;await assert.rejects(approveCollectionNoticeBatch(first.b,command));assert.deepEqual(await db.configurationProfile.findMany({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'},orderBy:{id:'asc'}}),baseline);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.approve'}}),0);}finally{if(installed)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_audience_approval_failure')}
    });
    await t.test("audience preview and atomic draft preparation preserve per-account review and financial baselines",async()=>{
      const first=await fixture(),second=await fixture(first),ids=[first.account.id,second.account.id],accounts=await db.account.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),ledger=await db.ledgerEntry.findMany({where:{accountId:{in:ids}},orderBy:{id:'asc'}});
      const preview=await previewCollectionNoticeBatch(first.a,ids);assert.equal(preview.items.length,2);assert.equal(preview.prepared,false);assert.equal(preview.emailSent,false);assert.equal(await db.configurationProfile.count({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'}}),0);
      const command={items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true},prepared=await prepareCollectionNoticeBatch(first.a,command);assert.equal(prepared.notices.length,2);assert.equal(prepared.emailSent,false);assert.ok(prepared.notices.every(notice=>notice.status==='DRAFT'&&!notice.canApprove));
      const again=await prepareCollectionNoticeBatch(first.a,command);assert.deepEqual(again.notices.map(notice=>[notice.id,notice.revision]),prepared.notices.map(notice=>[notice.id,notice.revision]));assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.prepared'}}),2);
      assert.deepEqual(await db.account.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),accounts);assert.deepEqual(await db.ledgerEntry.findMany({where:{accountId:{in:ids}},orderBy:{id:'asc'}}),ledger);assert.equal(await db.payment.count({where:{accountId:{in:ids}}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
      const reviewed=await reviewCollectionNotice(first.b,{id:prepared.notices[0].id,revision:prepared.notices[0].revision,action:'approve',reference:'CI individually reviewed'});await assert.rejects(prepareCollectionNoticeBatch(first.a,command),/IMMUTABLE/);assert.equal((await previewCollectionNotice(first.a,reviewed.accountId)).notice?.status,'APPROVED');assert.equal((await previewCollectionNotice(first.a,prepared.notices[1].accountId)).notice?.status,'DRAFT');
    });
    await t.test("a late changed or held recipient rolls back every earlier draft and preparation audit",async()=>{
      const first=await fixture(),second=await fixture(first),ids=[first.account.id,second.account.id].sort(),preview=await previewCollectionNoticeBatch(first.a,ids),last=ids.at(-1)===first.account.id?first:second;
      await db.customer.update({where:{id:last.customer.id},data:{communicationConsent:{email:false}}});
      const command={items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true};await assert.rejects(prepareCollectionNoticeBatch(first.a,command),/CHANGED/);
      const held=await previewCollectionNoticeBatch(first.a,ids);assert.ok(held.items.some(item=>item.source.blockers.length&&item.message===null));await assert.rejects(prepareCollectionNoticeBatch(first.a,{items:held.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true}),/HOLD/);
      assert.equal(await db.configurationProfile.count({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'}}),0);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.prepared'}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
    });
    await t.test("audiences enforce whole-set scope, confirmation, limits and duplicate rejection",async()=>{
      const first=await fixture(),foreign=await fixture(),preview=await previewCollectionNoticeBatch(first.a,[first.account.id]);await assert.rejects(previewCollectionNoticeBatch(first.a,[first.account.id,foreign.account.id]),/NOT_FOUND/);
      const command={items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true};await assert.rejects(prepareCollectionNoticeBatch(first.a,{...command,items:[...command.items,{accountId:foreign.account.id,fingerprint:'0'.repeat(64)}]}),/NOT_FOUND/);
      for(const input of [{...command,confirm:false},{...command,items:[...command.items,...command.items]},{...command,items:Array.from({length:21},(_,i)=>({accountId:'account-'+i,fingerprint:'0'.repeat(64)}))}])await assert.rejects(prepareCollectionNoticeBatch(first.a,input));
      assert.equal(await db.configurationProfile.count({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'}}),0);
    });
    await t.test("overlapping audience preparation retains one draft and one audit per account",async()=>{
      const first=await fixture(),second=await fixture(first),preview=await previewCollectionNoticeBatch(first.a,[first.account.id,second.account.id]),command={items:preview.items.map(item=>({accountId:item.source.accountId,fingerprint:item.source.fingerprint})),confirm:true};
      const results=await Promise.allSettled([prepareCollectionNoticeBatch(first.a,command),prepareCollectionNoticeBatch(first.a,command)]);assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal(await db.configurationProfile.count({where:{organisationId:first.org.id,domain:'COLLECTION_EMAIL_NOTICE'}}),2);assert.equal(await db.auditEvent.count({where:{organisationId:first.org.id,action:'collection.notice.prepared'}}),2);assert.equal(await db.communicationLog.count({where:{organisationId:first.org.id}}),0);
    });
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
      const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.deepEqual((log.metadata as {historyEvidence:unknown}).historyEvidence,historyEvidence(ready));assert.equal(log.attempts,1);assert.equal(log.deliveredAt,null);assert.equal(log.nextRetryAt,null);assert.equal(await db.ledgerEntry.count({where:{accountId:f.account.id}}),1);assert.equal((await db.account.findUniqueOrThrow({where:{id:f.account.id}})).balance.toString(),"100");
    });
    await t.test("provider timeout/failure requires review and never permits automatic or manual replay",async()=>{
      const f=await fixture(),ready=await approved(f);let calls=0;const provider={send:async()=>{calls++;throw Error("private provider detail")}};
      const failed=await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},provider);assert.equal(failed.status,"REVIEW_REQUIRED");assert.equal(failed.accepted,false);await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},provider);assert.equal(calls,1);
      const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.deepEqual((log.metadata as {historyEvidence:unknown}).historyEvidence,historyEvidence(ready));assert.equal(log.failureCode,"NOTICE_DELIVERY_REVIEW");assert.ok(!JSON.stringify(log).includes("private provider detail"));await assert.rejects(reviewCollectionNotice(f.a,{id:ready.id,revision:ready.revision,action:"reopen",reference:"CI replay"}),/IMMUTABLE/);
    });
    await t.test("actual letter producer remains downloadable with store-scoped content privacy and no ledger grant",async()=>{
      const f=await fixture(),ready=await approved(f);let attempts=0;
      await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{attempts++}});assert.equal(attempts,1);
      const query=historyQuerySchema.parse({kind:"COMMUNICATION"}),allowed={communications:f.a,collections:f.a,financial:null},low={...allowed,collections:null};
      const full=await customerHistory(f.a,f.customer.id,query,{...allowed,write:null});assert.match(full.entries[0].body??"",/R100.00/);
      const restricted=await customerHistory(f.a,f.customer.id,query,{...low,write:null});assert.doesNotMatch(restricted.entries[0].body??"",/R100.00/);assert.match(restricted.entries[0].body??"",/collection-view/);
      const other=await db.facility.create({data:{organisationId:f.org.id,name:"Other synthetic store",code:randomUUID()}}),crossed={...allowed,collections:{...f.a,facilityIds:[other.id]}};
      for(const access of [low,crossed])assert.equal((await customerHistory(f.a,f.customer.id,historyQuerySchema.parse({kind:"COMMUNICATION",search:"100.00"}),{...access,write:null})).entries.length,0);
      assert.equal((await customerHistory(f.a,f.customer.id,historyQuerySchema.parse({kind:"COMMUNICATION",search:"100.00"}),{...allowed,write:null})).entries.length,1);
      assert.ok(!(await customerHistory(f.a,f.customer.id,historyQuerySchema.parse({}),{...allowed,write:null})).entries.some(row=>row.kind==="ACCOUNT"));
      const exported=await buildCustomerHistoryExport(f.a,f.customer.id,query,allowed),withheld=await buildCustomerHistoryExport(f.a,f.customer.id,query,low);
      assert.equal((await hydrateCustomerHistoryMessages({scope:f.a,customerId:f.customer.id,phone:null,rows:exported.rows,access:allowed})).collectionBodiesReleased,true);
      assert.equal((await hydrateCustomerHistoryMessages({scope:f.a,customerId:f.customer.id,phone:null,rows:withheld.rows,access:low})).collectionBodiesReleased,false);
      assert.match(String(exported.rows[0].body),/R100.00/);assert.equal(withheld.rows[0].body,"");assert.equal(withheld.rows[0].subject,"");
      const csv=toCsv(exported.rows),privateCsv=toCsv(withheld.rows);assert.match(csv,/R100.00/);assert.doesNotMatch(privateCsv,/R100.00/);
      const xlsx=await customerHistoryExcel("Synthetic notice customer",exported.rows,"Synthetic real-producer history",new Date()),book=new ExcelJS.Workbook();await book.xlsx.load(xlsx.buffer as ArrayBuffer);assert.equal(book.worksheets[0].getCell("D6").value,exported.rows[0].body);assert.equal(book.worksheets[0].getCell("L6").value,exported.rows[0].subject);
      const pdf=await customerHistoryPdf("Synthetic notice customer",exported.rows,"Synthetic real-producer history",new Date());assert.ok((await PDFDocument.load(pdf)).getPageCount()>0);
      const global=await communicationLogPage(f.a,communicationFiltersSchema.parse({}));assert.doesNotMatch(JSON.stringify(global),/historyEvidence|R100.00/);
      await mkdir("output/notice-history-content",{recursive:true});await Promise.all([writeFile("output/notice-history-content/letter.csv",csv),writeFile("output/notice-history-content/letter.xlsx",xlsx),writeFile("output/notice-history-content/letter.pdf",pdf)]);
      assert.equal((await db.account.findUniqueOrThrow({where:{id:f.account.id}})).balance.toString(),"100");assert.equal(await db.ledgerEntry.count({where:{accountId:f.account.id}}),1);assert.equal(await db.payment.count({where:{accountId:f.account.id}}),0);
    });
    await t.test("audit failure rolls draft creation back and overlapping preparation cannot overwrite",async()=>{
      const f=await fixture(),p=await previewCollectionNotice(f.a,f.account.id);await assert.rejects(prepareCollectionNotice({...f.a,userId:"CI-missing-actor"},f.account.id,p.source.fingerprint));assert.equal((await previewCollectionNotice(f.a,f.account.id)).notice,null);
      const results=await Promise.allSettled([prepareCollectionNotice(f.a,f.account.id,p.source.fingerprint),prepareCollectionNotice(f.b,f.account.id,p.source.fingerprint)]);assert.ok(results.some(r=>r.status==="fulfilled"));assert.equal(await db.configurationProfile.count({where:{organisationId:f.org.id,domain:"COLLECTION_EMAIL_NOTICE"}}),1);
    });
    await t.test("provider acceptance followed by persistence failure retains a durable no-retry claim",async()=>{
      const f=await fixture(),ready=await approved(f);let calls=0,installed=false;
      try{const result=await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++;await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_notice_completion_failure CHECK (false) NOT VALID');installed=true}});
        assert.equal(result.status,"SENDING");await sendCollectionNotice(f.a,{id:ready.id,revision:ready.revision,confirm:true},{send:async()=>{calls++}});assert.equal(calls,1);const log=await db.communicationLog.findUniqueOrThrow({where:{idempotencyKey:ready.id}});assert.deepEqual((log.metadata as {historyEvidence:unknown}).historyEvidence,historyEvidence(ready));assert.equal(log.status,"PENDING");assert.equal(log.nextRetryAt,null);
      }finally{if(installed)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_notice_completion_failure')}
    });
  }finally{globalThis.fetch=nativeFetch;await db.$disconnect()}
});
