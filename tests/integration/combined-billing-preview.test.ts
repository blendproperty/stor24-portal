import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { monthlyBillingInvoices, saveMonthlyBillingPlan } from "../../src/lib/monthly-billing-service";
import { combinedBillingPreview, postCombinedBilling } from "../../src/lib/combined-billing-preview";

test.after(async () => { await db.$disconnect(); });
test("combined preview groups only confirmed tenants for one customer and facility without financial writes", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key=randomUUID(), org=await db.organisation.create({data:{name:"Synthetic",slug:key}}), store=await db.facility.create({data:{organisationId:org.id,code:key,name:"Store"}}), staff=await db.user.create({data:{organisationId:org.id,name:"Synthetic",email:`${key}@example.invalid`}}), customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic"}}), type=await db.unitType.create({data:{facilityId:store.id,name:"Unit"}});
  const scope={organisationId:org.id,userId:staff.id,facilityIds:[store.id],unrestrictedFacilities:false};
  const plan={firstPeriod:"2026-02",proration:"ACTUAL_DAYS" as const,taxPercent:0,rentTaxable:false,insuranceEnabled:false,insuranceTaxable:false,charges:[],discount:null,approvalReference:"synthetic approval"};
  const items=[];
  for (let i=0;i<2;i++) {
    const unit=await db.unit.create({data:{facilityId:store.id,unitTypeId:type.id,number:`C${i}`,monthlyRate:1000+i*500,status:"OCCUPIED"}});
    const account=await db.account.create({data:{customerId:customer.id,accountNumber:`CI-${key}-${i}`}});
    const tenancy=await db.tenancy.create({data:{facilityId:store.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date("2026-01-01T00:00:00+02:00"),occupancies:{create:{unitId:unit.id,status:"ACTIVE",monthlyRate:1000+i*500,startDate:new Date("2026-01-01T00:00:00+02:00")}}}});
    await saveMonthlyBillingPlan(scope,account.id,plan); items.push({account,tenancy});
    await db.auditEvent.create({data:{organisationId:org.id,facilityId:store.id,action:"tenancy.key_handover_confirmed",entityType:"Tenancy",entityId:tenancy.id}});
  }
  const input={customerId:customer.id,facilityId:store.id,period:"2026-02"};
  const preview=await combinedBillingPreview(scope,input);
  assert.equal(preview.accounts.length,2);assert.equal(preview.total,2500);assert.equal(preview.fingerprint.length,64);
  assert.equal(await db.ledgerEntry.count({where:{accountId:{in:items.map(item=>item.account.id)}}}),0);
  assert.equal(await db.document.count({where:{tenancyId:{in:items.map(item=>item.tenancy.id)}}}),0);
  assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
  await assert.rejects(combinedBillingPreview({...scope,facilityIds:[]},input),/COMBINED_REQUIRES_TWO/);
  await db.tenancy.update({where:{id:items[0].tenancy.id},data:{status:"NOTICE_GIVEN"}});
  await assert.rejects(combinedBillingPreview(scope,input),/COMBINED_NOTICE_REVIEW/);
  await db.tenancy.update({where:{id:items[0].tenancy.id},data:{status:"ACTIVE"}});
  await db.auditEvent.deleteMany({where:{entityId:items[0].tenancy.id,action:"tenancy.key_handover_confirmed"}});
  await assert.rejects(combinedBillingPreview(scope,input),/COMBINED_HANDOVER_REVIEW/);
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:store.id,action:"tenancy.key_handover_confirmed",entityType:"Tenancy",entityId:items[0].tenancy.id}});
  await assert.rejects(postCombinedBilling(scope,input,"0".repeat(64)),/BILLING_PREVIEW_CHANGED/);
  assert.equal(await db.ledgerEntry.count({where:{accountId:{in:items.map(item=>item.account.id)}}}),0);
  const refreshed=await combinedBillingPreview(scope,input);
  const outcomes=await Promise.allSettled([postCombinedBilling(scope,input,refreshed.fingerprint),postCombinedBilling(scope,input,refreshed.fingerprint)]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1, JSON.stringify(outcomes.map(x=>x.status === "rejected" ? String(x.reason) : "ok")));
  const posted=outcomes.find(x=>x.status==="fulfilled"); assert.ok(posted && posted.status==="fulfilled");
  assert.equal(await db.ledgerEntry.count({where:{accountId:{in:items.map(item=>item.account.id)}}}),2);
  assert.equal(await db.combinedInvoiceMembership.count({where:{documentId:posted.value.documentId}}),2);
  for(const item of items) assert.equal((await monthlyBillingInvoices(scope,item.account.id))[0].id,posted.value.documentId);
  const doc=await db.document.findUniqueOrThrow({where:{id:posted.value.documentId}});
  assert.ok(doc.content?.includes(items[0].account.accountNumber)); assert.ok(doc.content?.includes(items[1].account.accountNumber));
  assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
});
