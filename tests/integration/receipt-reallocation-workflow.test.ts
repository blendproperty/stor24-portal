import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {previewReceiptReallocation,requestReceiptReallocation,decideReceiptReallocation} from "../../src/lib/receipt-reallocation-service";
import {receiptAllocationGraph} from "../../src/lib/receipt-reallocation-source";
import {settleVerifiedBookingPayment} from "../../src/lib/payments/booking-payment-settlement";
import {collectionsWorkspace,collectionCohortOutcomes} from "../../src/lib/collections-service";
import {previewAdjustment,requestAdjustment,decideAdjustment,recordRefundPayout} from "../../src/lib/adjustment-service";
import {netCollectionTotal} from "../../src/lib/finance/collection-total";
import {southAfricaDateKey} from "../../src/lib/south-africa-time";
import type {ReceiptReallocationInput} from "../../src/lib/receipt-reallocation-policy";

test("isolated receipt correction producers retain cash, approval, undo and source integrity",async t=>{
  const url=new URL(process.env.DATABASE_URL!);assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(url.hostname));assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
  const organisations:string[]=[];
  async function fixture(){
    const org=await db.organisation.create({data:{name:"Synthetic receipt workflow",slug:randomUUID()}});organisations.push(org.id);
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic correction store",code:randomUUID()}});
    const requester=await db.user.create({data:{organisationId:org.id,name:"Synthetic requester",email:randomUUID()+"@example.invalid"}}),reviewer=await db.user.create({data:{organisationId:org.id,name:"Synthetic reviewer",email:randomUUID()+"@example.invalid"}});
    const accounts=[];
    for(let n=0;n<3;n++){
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"PRIVATE-SYNTHETIC-CUSTOMER-"+n}});
      const account=await db.account.create({data:{customerId:customer.id,accountNumber:"SYNTHETIC-ACCOUNT-"+randomUUID(),balance:n===0?-200:n===1?450:0}});
      await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,startDate:new Date("2026-01-01"),status:"ACTIVE"}});accounts.push(account);
      if(n===1)await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:450,description:"Synthetic original charge",effectiveAt:new Date("2026-01-01")}});
    }
    const [source,target,third]=accounts;
    const payment=await db.payment.create({data:{accountId:source.id,status:"SUCCEEDED",amount:200,currency:"ZAR",method:"EFT",provider:"NETCASH",environment:"live",providerRef:randomUUID(),idempotencyKey:randomUUID(),processedAt:new Date("2026-01-02")}});
    const original=await db.ledgerEntry.create({data:{accountId:source.id,type:"PAYMENT",amount:200,description:"Synthetic original verified receipt",effectiveAt:new Date("2026-01-02"),externalRef:"netcash-payment:"+payment.id,metadata:{paymentId:payment.id,verifiedStatus:true,environment:"live"}}});
    const scope={organisationId:org.id,userId:requester.id,facilityIds:[facility.id],unrestrictedFacilities:false};
    return {org,facility,requester,reviewer,source,target,third,payment,original,scope,reviewScope:{...scope,userId:reviewer.id}};
  }
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const input=(f:Fixture):ReceiptReallocationInput=>({sourceAccountId:f.source.id,sourceEntryId:f.original.id,targetAccountId:f.target.id,amount:"75.25",reason:"Correct the documented synthetic receipt allocation",evidenceReference:"Synthetic independent source evidence",requestKey:randomUUID()});
  const balances=(f:Fixture)=>db.account.findMany({where:{id:{in:[f.source.id,f.target.id,f.third.id]}},orderBy:{id:"asc"},select:{id:true,balance:true}});
  const graph=(f:Fixture)=>db.$transaction(tx=>receiptAllocationGraph(tx,f.scope,f.payment.id),{isolationLevel:"RepeatableRead"});
  async function request(f:Fixture,data:ReceiptReallocationInput){const p=await previewReceiptReallocation(f.scope,data);return requestReceiptReallocation(f.scope,data,p.fingerprint);}
  const approve=(f:Fixture,id:string,reference="Synthetic independent approval")=>decideReceiptReallocation(f.reviewScope,id,0,"approve",reference);
  try{
    await t.test("one partial move posts equal opposite entries and private account documents without a new external payment",async()=>{
      const f=await fixture(),before=await balances(f),data=input(f),r=await request(f,data);
      assert.deepEqual(await balances(f),before);await assert.rejects(decideReceiptReallocation(f.scope,r.id,0,"approve","Invalid self approval"),/INDEPENDENT/);
      await assert.rejects(decideReceiptReallocation({...f.reviewScope,facilityIds:[]},r.id,0,"approve","Outside store"),/NOT_FOUND/);
      await approve(f,r.id);assert.equal((await approve(f,r.id)).idempotent,true);
      const row=await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}});assert.equal(row.status,"POSTED");assert.equal(await db.payment.count({where:{account:{customer:{organisationId:f.org.id}}}}),1);
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      const proof=await graph(f);assert.equal(proof.positions.reduce((n,p)=>n+Math.round(Number(p.remaining)*100),0),20000);assert.equal(proof.positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");
      assert.equal((await db.account.findUniqueOrThrow({where:{id:f.source.id}})).balance.toFixed(2),"-124.75");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.target.id}})).balance.toFixed(2),"374.75");
      const docs=await db.document.findMany({where:{id:{in:[row.sourceDocumentId!,row.targetDocumentId!]}}});assert.equal(docs.length,2);
      for(const doc of docs){assert.ok(!doc.content?.includes("PRIVATE-SYNTHETIC-CUSTOMER"));assert.ok(!doc.content?.includes(doc.id===row.sourceDocumentId?f.target.accountNumber:f.source.accountNumber));}
      const count=await db.ledgerEntry.count({where:{accountId:{in:[f.source.id,f.target.id]}}});
      await settleVerifiedBookingPayment(f.payment.id,{reference:f.payment.providerRef!,amount:200,accepted:true,requestTrace:"synthetic-replay"});assert.equal(await db.ledgerEntry.count({where:{accountId:{in:[f.source.id,f.target.id]}}}),count);
    });
    await t.test("transitive allocations and partial undo restore the original receipt without rewriting it",async()=>{
      const f=await fixture(),first=await request(f,input(f));await approve(f,first.id);
      const firstRow=await db.receiptReallocation.findUniqueOrThrow({where:{id:first.id}});
      const next={...input(f),sourceAccountId:f.target.id,sourceEntryId:firstRow.targetLedgerEntryId!,targetAccountId:f.third.id,amount:"25.25"};
      const child=await request(f,next);await approve(f,child.id);
      const childRow=await db.receiptReallocation.findUniqueOrThrow({where:{id:child.id}});
      const undo:ReceiptReallocationInput={...input(f),operation:"UNDO",reversesId:first.id,sourceAccountId:f.target.id,sourceEntryId:firstRow.targetLedgerEntryId!,targetAccountId:f.source.id,amount:"75.25"};
      await assert.rejects(previewReceiptReallocation(f.scope,undo),/EXCEEDS_RECEIPT/);
      const undoChild=await request(f,{...input(f),operation:"UNDO",reversesId:child.id,sourceAccountId:f.third.id,sourceEntryId:childRow.targetLedgerEntryId!,targetAccountId:f.target.id,amount:"25.25"});await approve(f,undoChild.id);
      const partial=await request(f,{...undo,amount:"25.25"});await approve(f,partial.id);
      const rest=await request(f,{...undo,requestKey:randomUUID(),amount:"50.00"});await approve(f,rest.id);
      const proof=await graph(f);assert.equal(proof.positions.find(p=>p.entryId===f.original.id)?.remaining,"200.00");assert.ok(proof.positions.filter(p=>p.entryId!==f.original.id).every(p=>p.remaining==="0.00"));
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      assert.equal((await db.account.findUniqueOrThrow({where:{id:f.source.id}})).balance.toFixed(2),"-200.00");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.target.id}})).balance.toFixed(2),"450.00");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.third.id}})).balance.toFixed(2),"0.00");
    });
    await t.test("collections and native financial outcomes conserve allocations without treating old cash as a new promise receipt",async()=>{
      const f=await fixture(),today=southAfricaDateKey(new Date());
      const c=await db.collectionCase.create({data:{accountId:f.target.id,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"Synthetic finance approved terms",overrides:[]}}});
      await db.collectionPromise.create({data:{caseId:c.id,amount:"75.25",dueDate:today,createdAt:new Date(Date.now()-1),createdById:f.requester.id}});
      const data=input(f),r=await request(f,data);
      assert.match((await collectionsWorkspace(f.scope,today)).rows.find(a=>a.id===f.target.id)!.hold!,/allocation awaiting independent review/);
      await approve(f,r.id);
      const queue=await collectionsWorkspace(f.scope,today),target=queue.rows.find(a=>a.id===f.target.id)!;assert.equal(target.ageing.issue,null);assert.equal(target.ageing.overdue,37475);assert.equal(target.promises[0].progress?.received,0);assert.equal(target.promises[0].progress?.covered,false);
      const outcomes=await db.$transaction(tx=>collectionCohortOutcomes(tx,f.scope,[f.source.id,f.target.id,f.third.id],today));assert.ok(outcomes.every(r=>!r.issue));assert.equal(outcomes.reduce((n,r)=>n+(r.netReceiptCents??0),0),20000);assert.equal(await netCollectionTotal(f.scope,new Date(0)),200);
      await db.auditEvent.updateMany({where:{entityId:r.id,action:"receipt_reallocation.posted"},data:{action:"synthetic.unproven_allocation"}});
      const held=await db.$transaction(tx=>collectionCohortOutcomes(tx,f.scope,[f.source.id,f.target.id],today));assert.ok(held.every(r=>r.issue&&r.netReceiptCents===null&&r.overdueCents===null));
    });
    await t.test("refunds are limited to the original receipt position and a fully undone allocation permits the existing full reversal",async()=>{
      const f=await fixture(),r=await request(f,input(f));await approve(f,r.id);
      const other=await db.payment.create({data:{accountId:f.source.id,status:"SUCCEEDED",amount:100,method:"EFT",provider:"NETCASH",environment:"live",idempotencyKey:randomUUID(),processedAt:new Date()}});
      await db.ledgerEntry.create({data:{accountId:f.source.id,type:"PAYMENT",amount:100,description:"Synthetic separate receipt",effectiveAt:new Date(),externalRef:"netcash-payment:"+other.id,metadata:{paymentId:other.id,verifiedStatus:true,environment:"live"}}});await db.account.update({where:{id:f.source.id},data:{balance:{decrement:100}}});
      const refund={accountId:f.source.id,kind:"REFUND" as const,amount:"124.76",taxAmount:"0",sourceEntryId:f.original.id,reason:"Synthetic external refund recorded separately",evidenceReference:"Synthetic refund proof"};
      await assert.rejects(previewAdjustment(f.scope,refund),/EXCEEDS_SOURCE/);
      const valid={...refund,amount:"25.25"},preview=await previewAdjustment(f.scope,valid),adjustment=await requestAdjustment(f.scope,valid,preview.fingerprint,randomUUID());
      await decideAdjustment(f.reviewScope,adjustment.id,"approve","Synthetic refund approval");await recordRefundPayout(f.reviewScope,adjustment.id,"SYNTHETIC-PAYOUT-"+randomUUID(),southAfricaDateKey(new Date()));
      assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"99.50");assert.equal(await netCollectionTotal(f.scope,new Date(0)),274.75);
      const g=await fixture(),move=await request(g,input(g));await approve(g,move.id);const moved=await db.receiptReallocation.findUniqueOrThrow({where:{id:move.id}});
      const undo=await request(g,{...input(g),operation:"UNDO",reversesId:move.id,sourceAccountId:g.target.id,sourceEntryId:moved.targetLedgerEntryId!,targetAccountId:g.source.id});await approve(g,undo.id);
      const reversal={...refund,accountId:g.source.id,sourceEntryId:g.original.id,kind:"REVERSAL" as const,amount:"200.00"},p=await previewAdjustment(g.scope,reversal),a=await requestAdjustment(g.scope,reversal,p.fingerprint,randomUUID());await decideAdjustment(g.reviewScope,a.id,"approve","Synthetic full receipt reversal");
      assert.equal((await graph(g)).root.status,"REVERSED");assert.equal(await netCollectionTotal(g.scope,new Date(0)),0);
      const count=await db.ledgerEntry.count({where:{accountId:g.source.id}});await settleVerifiedBookingPayment(g.payment.id,{reference:g.payment.providerRef!,amount:200,accepted:true,requestTrace:"synthetic-after-reversal"});assert.equal(await db.ledgerEntry.count({where:{accountId:g.source.id}}),count);assert.equal((await db.payment.findUniqueOrThrow({where:{id:g.payment.id}})).status,"REVERSED");
    });
    await t.test("concurrent identical requests are idempotent and competing approvals post once",async()=>{
      const f=await fixture(),data=input(f),p=await previewReceiptReallocation(f.scope,data);
      const requests=await Promise.all([requestReceiptReallocation(f.scope,data,p.fingerprint),requestReceiptReallocation(f.scope,data,p.fingerprint)]);assert.equal(requests[0].id,requests[1].id);
      const approvals=await Promise.allSettled([approve(f,requests[0].id),approve(f,requests[0].id)]);assert.ok(approvals.some(r=>r.status==="fulfilled"));assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id,status:"POSTED"}}),1);assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");
    });
    await t.test("a proven rolled-back serialization conflict retries the same approval without duplicate effects",async()=>{
      const f=await fixture(),r=await request(f,input(f)),suffix=randomUUID().replaceAll("-",""),name="receipt_retry_"+suffix,sequence="receipt_seq_"+suffix;assert.match(f.org.id,/^[a-z0-9]+$/);
      await db.$executeRawUnsafe(`CREATE SEQUENCE "${sequence}"`);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organisationId"='${f.org.id}' THEN IF NEW."action"='receipt_reallocation.posted' THEN IF nextval('${sequence}')=1 THEN RAISE EXCEPTION 'Synthetic serialization rollback' USING ERRCODE='40001'; END IF; END IF; END IF; RETURN NEW; END; $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
      try{await approve(f,r.id);}finally{await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);await db.$executeRawUnsafe(`DROP SEQUENCE "${sequence}"`);}
      assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id,status:"POSTED"}}),1);assert.equal(await db.auditEvent.count({where:{entityId:r.id,action:"receipt_reallocation.posted"}}),1);assert.equal(await db.document.count({where:{tenancy:{facilityId:f.facility.id}}}),2);assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
    });
    await t.test("changed sources cannot post and a requested correction can be cancelled without money changes",async()=>{
      const f=await fixture(),r=await request(f,input(f));
      await db.ledgerEntry.create({data:{accountId:f.source.id,type:"CHARGE",amount:1,description:"Synthetic intervening event",effectiveAt:new Date()}});await db.account.update({where:{id:f.source.id},data:{balance:{increment:1}}});
      const before=await balances(f);await assert.rejects(approve(f,r.id),/CHANGED/);assert.deepEqual(await balances(f),before);
      await decideReceiptReallocation(f.scope,r.id,0,"cancel","Synthetic stale request cancellation");assert.equal((await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}})).status,"CANCELLED");assert.deepEqual(await balances(f),before);
    });
    await t.test("posted audit failure rolls back both balances, entries, documents and decision",async()=>{
      const f=await fixture(),r=await request(f,input(f)),before=await balances(f),entryCount=await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}});
      const name="receipt_post_"+randomUUID().replaceAll("-","");assert.match(f.org.id,/^[a-z0-9]+$/);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${name}" CHECK ("organisationId" <> '${f.org.id}' OR "action" <> 'receipt_reallocation.posted') NOT VALID`);
      try{await assert.rejects(approve(f,r.id));}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${name}"`);}
      assert.deepEqual(await balances(f),before);assert.equal(await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}}),entryCount);assert.equal(await db.document.count({where:{tenancy:{facilityId:f.facility.id}}}),0);assert.equal((await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}})).status,"PENDING_APPROVAL");assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
    });
  }finally{
    for(const organisationId of organisations){
      await db.receiptReallocation.deleteMany({where:{organisationId}});await db.auditEvent.deleteMany({where:{organisationId}});await db.document.deleteMany({where:{tenancy:{facility:{organisationId}}}});await db.collectionPromise.deleteMany({where:{case:{account:{customer:{organisationId}}}}});await db.collectionActivity.deleteMany({where:{case:{account:{customer:{organisationId}}}}});await db.collectionCase.deleteMany({where:{account:{customer:{organisationId}}}});await db.financialAdjustment.deleteMany({where:{organisationId}});await db.ledgerEntry.deleteMany({where:{account:{customer:{organisationId}}}});await db.payment.deleteMany({where:{account:{customer:{organisationId}}}});await db.tenancy.deleteMany({where:{facility:{organisationId}}});await db.account.deleteMany({where:{customer:{organisationId}}});await db.organisation.delete({where:{id:organisationId}});
    }
    await db.$disconnect();
  }
});
