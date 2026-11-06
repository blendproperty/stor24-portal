import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { currentBillingPeriod, nextBillingPeriod } from "../../src/lib/monthly-billing-policy";
import { postMonthlyBilling, previewMonthlyBilling, previewNextMonthForReview, saveMonthlyBillingPlan } from "../../src/lib/monthly-billing-service";

test("next month review is scoped, read-only and cannot post future charges", async () => {
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 try {
  assert.equal(nextBillingPeriod(new Date("2026-12-20T08:00:00Z")),"2027-01");
  assert.equal(nextBillingPeriod(new Date("2026-11-30T22:30:00Z")),"2027-01");
  const key=randomUUID(), org=await db.organisation.create({data:{name:"Synthetic",slug:key}}), facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic",code:key}}), user=await db.user.create({data:{organisationId:org.id,name:"Synthetic",email:`${key}@example.invalid`}}), customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic"}}), type=await db.unitType.create({data:{facilityId:facility.id,name:"Unit"}}), unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"N1",monthlyRate:1200,status:"OCCUPIED"}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:`N-${key}`}}),tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date("2025-01-01"),occupancies:{create:{unitId:unit.id,status:"ACTIVE",startDate:new Date("2025-01-01"),monthlyRate:1200}}}});
  const scope={organisationId:org.id,userId:user.id,facilityIds:[facility.id],unrestrictedFacilities:false},period=nextBillingPeriod();
  const plan={firstPeriod:currentBillingPeriod(),proration:"ACTUAL_DAYS" as const,taxPercent:15,rentTaxable:true,insuranceEnabled:false,insuranceTaxable:false,charges:[],discount:null,approvalReference:"Synthetic approved plan"};
  await saveMonthlyBillingPlan(scope,account.id,plan);
  await assert.rejects(previewNextMonthForReview(scope,account.id),/HANDOVER_REVIEW/);
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,entityType:"Tenancy",entityId:tenancy.id,action:"tenancy.key_handover_confirmed"}});
  const bill=await previewNextMonthForReview(scope,account.id);assert.equal(bill.period,period);assert.equal(bill.total,1200);
  await assert.rejects(previewNextMonthForReview({...scope,facilityIds:[]},account.id),/ACCOUNT_NOT_FOUND/);
  await assert.rejects(previewMonthlyBilling(scope,account.id,period),/FUTURE_PERIOD/);
  await assert.rejects(postMonthlyBilling(scope,account.id,period,bill.fingerprint),/FUTURE_PERIOD/);
  assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);assert.equal(await db.document.count({where:{tenancyId:tenancy.id}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
  await db.tenancy.update({where:{id:tenancy.id},data:{status:"NOTICE_GIVEN"}});await assert.rejects(previewNextMonthForReview(scope,account.id),/NOTICE_POLICY_REVIEW/);
  await db.tenancy.update({where:{id:tenancy.id},data:{status:"ACTIVE"}});
  await saveMonthlyBillingPlan(scope,account.id,{...plan,discount:{name:"Synthetic offer",type:"PERCENTAGE",value:10,startsPeriod:period,endsPeriod:period}});
  await assert.rejects(previewNextMonthForReview(scope,account.id),/DISCOUNT_POLICY_REVIEW/);
 } finally {await db.$disconnect();}
});
