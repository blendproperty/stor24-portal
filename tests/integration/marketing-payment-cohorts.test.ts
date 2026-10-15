import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {newPublicInitialRent} from "../../src/lib/public-initial-rent";
import {recordEnquiryLocation} from "../../src/lib/enquiry-location";
import {visualReportSource} from "../../src/lib/visual-report-data";
import {defaultVisualQuery} from "../../src/lib/visual-report-engine";

test("isolated cohort reports bind original CRM identities and verified ledger outcomes without writes",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
  assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const org=await db.organisation.create({data:{name:"Synthetic cohort reporting",slug:randomUUID()}});
  const facility=await db.facility.create({data:{organisationId:org.id,name:"Cohort fixture store",code:randomUUID()}});
  const other=await db.facility.create({data:{organisationId:org.id,name:"Excluded cohort store",code:randomUUID()}});
  const user=await db.user.create({data:{organisationId:org.id,name:"Synthetic reporter",email:randomUUID()+"@example.invalid"}});
  const customer=await db.customer.create({data:{organisationId:org.id,firstName:"PRIVATE-COHORT-NAME",email:"private-cohort@example.invalid"}});
  const type=await db.unitType.create({data:{facilityId:facility.id,name:"Cohort fixture"}});
  const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"COHORT-CI",floor:"Ground Floor",monthlyRate:9999,status:"OCCUPIED"}});
  const start=new Date("2026-10-01T10:00:00Z");
  const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:800}});
  const tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,startDate:start}});
  const lead=await db.lead.create({data:{facilityId:facility.id,customerId:customer.id,source:"PUBLIC_QUOTE_FORM",stage:"WON",createdAt:start,enquiryLocation:recordEnquiryLocation({city:"Cape Town",postalCode:"0012"},"PUBLIC_SELF_REPORTED",start)}});
  await db.lead.create({data:{facilityId:facility.id,source:"PHONE",createdAt:start}});
  await db.reservation.create({data:{facilityId:facility.id,customerId:customer.id,unitId:unit.id,leadId:lead.id,status:"CONVERTED",quotedRate:123.45,initialRentSnapshot:newPublicInitialRent(123.45,start),intendedMoveIn:start,convertedTenancyId:tenancy.id}});
  const campaign=await db.marketingCampaign.create({data:{organisationId:org.id,facilityId:facility.id,name:"Original campaign current label",source:"google",medium:"cpc",budget:0,startsAt:start}});
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,entityType:"Lead",entityId:lead.id,action:"public_lead.created",after:{attribution:{version:1,consent:"granted",landingPage:"/",conversionPage:"/contact",pages:["/","/contact"],source:"google",medium:"cpc",campaignId:campaign.id}}}});
  await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:1000,description:"Synthetic rent",effectiveAt:start}});
  const payment=await db.payment.create({data:{accountId:account.id,amount:200,method:"EFT",status:"SUCCEEDED",environment:"live",idempotencyKey:randomUUID(),processedAt:new Date("2026-10-03")}});
  await db.ledgerEntry.create({data:{accountId:account.id,type:"PAYMENT",amount:200,description:"Synthetic verified receipt",effectiveAt:new Date("2026-10-03"),externalRef:payment.idempotencyKey,metadata:{paymentId:payment.id}}});
  const proof=await db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,entityType:"Payment",entityId:payment.id,action:"payment.posted"}});
  await db.collectionCase.create({data:{accountId:account.id,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"Synthetic original due terms",overrides:[]}}});
  const scope={organisationId:org.id,userId:user.id,facilityIds:[facility.id],unrestrictedFacilities:false};
  const query=defaultVisualQuery("marketing-payment-cohorts","2026-10-01","2026-10-14");
  const baseline=()=>Promise.all([db.account.findMany({where:{id:account.id}}),db.payment.findMany({where:{accountId:account.id}}),db.ledgerEntry.findMany({where:{accountId:account.id},orderBy:{id:"asc"}}),db.reservation.findMany({where:{leadId:lead.id},orderBy:{id:"asc"}}),db.auditEvent.count({where:{organisationId:org.id}})]);
  try{
    await t.test("source/campaign/location/saved quote and posted outcomes join with unchanged financial baselines",async()=>{
      const before=await baseline(),rows=await visualReportSource(scope,query),row=rows.find(r=>r.enquiry===lead.id)!;
      assert.equal(rows.length,2);assert.equal(row.acquisitionSource,"google");assert.equal(row.campaign,campaign.name);assert.equal(row.postalCode,"0012");assert.equal(row.originalMonthlyQuote,"123.45");assert.equal(row.netReceipts,"200.00");assert.equal(row.overdue,"800.00");assert.equal(row.paymentOutcome,"OVERDUE");assert.equal(row.review,null);
      assert.ok(rows.some(r=>r.paymentOutcome==="NOT_CONVERTED"));assert.ok(!JSON.stringify(rows).includes("PRIVATE-COHORT-NAME"));assert.ok(!JSON.stringify(rows).includes("private-cohort@example.invalid"));assert.deepEqual(await baseline(),before);
    });
    await t.test("store, original source and as-of boundaries are enforced",async()=>{
      assert.deepEqual(await visualReportSource({...scope,facilityIds:[other.id]},query),[]);
      await assert.rejects(visualReportSource(scope,{...query,facilityId:other.id}),/FORBIDDEN/);
      await assert.rejects(visualReportSource(scope,{...query,historyImportId:randomUUID()}),/REPORT_COHORT_SOURCE/);
      const row=(await visualReportSource(scope,{...query,to:"2026-10-02"})).find(r=>r.enquiry===lead.id)!;
      assert.equal(row.netReceipts,"0.00");assert.equal(row.overdue,"1000.00");
      await assert.rejects(visualReportSource(scope,{...query,to:"2099-01-01"}),/REPORT_ASOF_FUTURE/);
    });
    await t.test("missing posting proof and test payment evidence hold financial values and totals",async()=>{
      await db.auditEvent.update({where:{id:proof.id},data:{action:"synthetic.unverified"}});
      const row=(await visualReportSource(scope,query)).find(r=>r.enquiry===lead.id)!;assert.equal(row.netReceipts,null);assert.equal(row.overdue,null);assert.equal(row.paymentOutcome,"REVIEW_REQUIRED");
      await assert.rejects(visualReportSource(scope,{...query,groupBy:["currency"],metrics:[{field:"netReceipts",operation:"sum"}]}),/REPORT_COHORT_REVIEW/);
      await db.auditEvent.update({where:{id:proof.id},data:{action:"payment.posted"}});
      await db.payment.update({where:{id:payment.id},data:{environment:"sandbox"}});
      assert.equal((await visualReportSource(scope,query)).find(r=>r.enquiry===lead.id)!.netReceipts,null);
      await db.payment.update({where:{id:payment.id},data:{environment:"live"}});
    });
  }finally{
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});
    await db.reservation.deleteMany({where:{facilityId:facility.id}});await db.lead.deleteMany({where:{facilityId:facility.id}});
    await db.collectionCase.deleteMany({where:{accountId:account.id}});await db.ledgerEntry.deleteMany({where:{accountId:account.id}});await db.payment.deleteMany({where:{accountId:account.id}});
    await db.tenancy.delete({where:{id:tenancy.id}});await db.account.delete({where:{id:account.id}});await db.customer.delete({where:{id:customer.id}});
    await db.unit.delete({where:{id:unit.id}});await db.unitType.delete({where:{id:type.id}});await db.marketingCampaign.delete({where:{id:campaign.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});
