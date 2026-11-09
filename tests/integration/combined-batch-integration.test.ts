import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { currentBillingPeriod, nextBillingPeriod } from "../../src/lib/monthly-billing-policy";
import { saveMonthlyBillingPlan, monthlyBillingInvoices } from "../../src/lib/monthly-billing-service";
import { runNextMonthInvoices } from "../../src/lib/next-month-invoice-run";
import { saveInvoiceSchedule } from "../../src/lib/invoice-schedule";
import { southAfricaDateKey } from "../../src/lib/south-africa-time";
import { reviewInvoiceDraftBatch, approveInvoiceDraftBatch } from "../../src/lib/invoice-draft-batch";
import { sendSavedInvoice } from "../../src/lib/finance/saved-invoice-delivery";

test("combined scheduled invoices are reviewed once, posted atomically and safely delivered", async () => {
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 const key=randomUUID(), org=await db.organisation.create({data:{name:"Synthetic",slug:key}}), facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic",code:key}}), user=await db.user.create({data:{organisationId:org.id,name:"Synthetic",email:`${key}@example.invalid`}}), customer=await db.customer.create({data:{organisationId:org.id,firstName:"Combined",email:`${key}@example.invalid`}}), type=await db.unitType.create({data:{facilityId:facility.id,name:"Unit"}});
 const scope={organisationId:org.id,userId:user.id,facilityIds:[facility.id],unrestrictedFacilities:false};
 const plan={firstPeriod:currentBillingPeriod(),proration:"ACTUAL_DAYS" as const,taxPercent:0,rentTaxable:false,insuranceEnabled:false,insuranceTaxable:false,charges:[],discount:null,approvalReference:"Synthetic"};
 const accounts=[]; const tenancies=[];
 for (let i=0;i<2;i++) {
  const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:`T${i}`,monthlyRate:1000+i*500,status:"OCCUPIED"}});
  const account=await db.account.create({data:{customerId:customer.id,accountNumber:`T${i}-${key}`}});
  const tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date("2025-01-01"),occupancies:{create:{unitId:unit.id,status:"ACTIVE",startDate:new Date("2025-01-01"),monthlyRate:1000+i*500}}}});
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,entityType:"Tenancy",entityId:tenancy.id,action:"tenancy.key_handover_confirmed"}});
  await saveMonthlyBillingPlan(scope,account.id,plan); accounts.push(account); tenancies.push(tenancy);
 }
 process.env.NEXT_MONTH_INVOICING_ENABLED="true"; process.env.AUTH_SECRET="synthetic-test-secret-not-production-123456";
 await saveInvoiceSchedule(scope,facility.id,{date:southAfricaDateKey(new Date())});
 const run=await runNextMonthInvoices(new Date(),org.id); assert.equal(run.generated,1); assert.equal(run.exceptions.length,0);
 assert.equal(await db.ledgerEntry.count({where:{accountId:{in:accounts.map(a=>a.id)}}}),0);
 assert.equal(await db.document.count({where:{tenancyId:{in:tenancies.map(t=>t.id)}}}),0);
 const review=await reviewInvoiceDraftBatch(scope,accounts.map(a=>a.id)); assert.equal(review.length,1); const draft=review[0].draft; assert.ok(draft); assert.equal(draft.total,2500); assert.equal(draft.lines.length,2);
 const held=await reviewInvoiceDraftBatch({...scope,facilityIds:[]},[accounts[0].id]); assert.equal(held[0].draft,null);
 const item={accountId:review[0].accountId,period:nextBillingPeriod(),fingerprint:draft.fingerprint};
 await db.tenancy.update({where:{id:tenancies[1].id},data:{status:"NOTICE_GIVEN"}});
 const changed=await approveInvoiceDraftBatch(scope,[item]); assert.equal(changed[0].posted,null); assert.equal(await db.ledgerEntry.count({where:{accountId:{in:accounts.map(a=>a.id)}}}),0);
 await db.tenancy.update({where:{id:tenancies[1].id},data:{status:"ACTIVE"}});
 // Refresh the draft after the deliberate status change.
 await runNextMonthInvoices(new Date(),org.id);
 const fresh=await reviewInvoiceDraftBatch(scope,[accounts[1].id]); assert.ok(fresh[0].draft);
 const request={accountId:accounts[1].id,period:nextBillingPeriod(),fingerprint:fresh[0].draft!.fingerprint};
 const approvals=await Promise.all([approveInvoiceDraftBatch(scope,[request]),approveInvoiceDraftBatch(scope,[request])]);
 const posted=approvals.flat().filter(result=>result.posted); assert.equal(posted.length,1);
 const id=posted[0].posted!.documentId; assert.equal(await db.combinedInvoiceMembership.count({where:{documentId:id}}),2);
 assert.equal(await db.ledgerEntry.count({where:{accountId:{in:accounts.map(a=>a.id)}}}),2);
 for (const account of accounts) assert.ok((await monthlyBillingInvoices(scope,account.id)).some(d=>d.id===id));
 const again=await approveInvoiceDraftBatch(scope,[{accountId:accounts[1].id,period:nextBillingPeriod(),fingerprint:fresh[0].draft!.fingerprint}]); assert.equal(again[0].posted,null);
 let deliveries=0; const provider={send:async()=>{deliveries++;}}; const email=customer.email!;
 await db.tenancy.update({where:{id:tenancies[1].id},data:{status:"NOTICE_GIVEN"}});
 await assert.rejects(sendSavedInvoice(scope,id,randomUUID(),email,false,provider),/INVOICE_NOTICE_REVIEW/);
 await db.tenancy.update({where:{id:tenancies[1].id},data:{status:"ACTIVE"}});
 await assert.rejects(sendSavedInvoice(scope,id,randomUUID(),"other@example.invalid",false,provider),/INVOICE_RECIPIENT_CHANGED/);
 const sendId=randomUUID(); await sendSavedInvoice(scope,id,sendId,email,false,provider); await sendSavedInvoice(scope,id,sendId,email,false,provider); assert.equal(deliveries,1);
 await sendSavedInvoice(scope,id,randomUUID(),email,false,provider); assert.equal(deliveries,2);
 assert.equal(await db.ledgerEntry.count({where:{accountId:{in:accounts.map(a=>a.id)}}}),2);
});
test.after(async () => { await db.$disconnect(); });
