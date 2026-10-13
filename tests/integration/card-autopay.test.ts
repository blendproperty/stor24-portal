import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { previewCardAutopayRequest, saveCardAutopayRequest, withdrawCardAutopayRequest } from "../../src/lib/payments/card-autopay-service";
const schedule = { startDate: "2026-11-01", cycles: 12 };
const now = new Date("2026-10-13T10:00:00+02:00");
test("isolated PostgreSQL card autopay preparation", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key=randomUUID();
    const org=await db.organisation.create({data:{name:"Card test",slug:key}});
    const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:"Synthetic store"}});
    const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic",email:key+"@example.invalid",emailVerifiedAt:now}});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic",features:[]}});
    const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"101",monthlyRate:950,status:"OCCUPIED"}});
    const account=await db.account.create({data:{customerId:customer.id,accountNumber:"CARD-"+key}});
    const tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",paymentMethod:"CARD",startDate:new Date("2026-01-01"),occupancies:{create:{unitId:unit.id,status:"ACTIVE",monthlyRate:950,startDate:new Date("2026-01-01")}}}});
    const document=await db.document.create({data:{tenancyId:tenancy.id,type:"LEASE_AGREEMENT",status:"SIGNED",storageKey:"synthetic://lease",provider:"BLENDSIGN",externalId:key,signedAt:now}});
    const profile=await db.configurationProfile.create({data:{organisationId:org.id,facilityId:facility.id,domain:"MONTHLY_BILLING",name:account.id,status:"READY",config:{firstPeriod:"2026-11",proration:"FULL_MONTH",taxPercent:15,rentTaxable:true,insuranceEnabled:false,insuranceTaxable:false,charges:[],discount:null,approvalReference:"Synthetic fixture"}}});
    return {org,facility,customer,account,tenancy,document,profile,session:{organisationId:org.id,email:customer.email!,customerIds:[customer.id]}};
  }
  try {
    await t.test("preview and explicit request never create a payment, charge, collection or active subscription", async()=>{
      const f=await fixture();const before=await db.account.findUniqueOrThrow({where:{id:f.account.id}});
      const p=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);assert.equal(p.monthlyAmount,"950.00");assert.equal(p.providerEnrollmentAvailable,false);
      assert.equal(await db.configurationProfile.count({where:{domain:"CARD_AUTOPAY_REQUEST",name:f.account.id}}),0);
      await assert.rejects(saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,false,now),/NOT_ACCEPTED/);
      const r=await saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now);assert.equal(r.status,"REQUESTED");
      const duplicate=await saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now);assert.equal(duplicate.id,r.id);
      assert.equal(await db.auditEvent.count({where:{entityId:f.account.id,action:"card_autopay.request_recorded"}}),1);
      assert.equal(await db.payment.count({where:{accountId:f.account.id}}),0);assert.equal(await db.ledgerEntry.count({where:{accountId:f.account.id}}),0);assert.equal(await db.debitOrderInstruction.count({where:{accountId:f.account.id}}),0);
      const after=await db.account.findUniqueOrThrow({where:{id:f.account.id}});assert.equal(after.balance.toString(),before.balance.toString());assert.equal(after.updatedAt.toISOString(),before.updatedAt.toISOString());
    });
    await t.test("tenant ownership, email verification and organisation scope cannot be substituted", async()=>{
      const f=await fixture();for(const session of [{...f.session,customerIds:[]},{...f.session,email:"other@example.invalid"},{...f.session,organisationId:"other"}]) await assert.rejects(previewCardAutopayRequest(session,f.account.id,schedule,now),/TENANT_NOT_FOUND/);
      await db.customer.update({where:{id:f.customer.id},data:{emailVerifiedAt:null}});await assert.rejects(previewCardAutopayRequest(f.session,f.account.id,schedule,now),/TENANT_NOT_FOUND/);
    });
    await t.test("changed rates require fresh review and a changing fixed schedule is refused",async()=>{
      const f=await fixture();const p=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);
      await db.occupancy.updateMany({where:{tenancyId:f.tenancy.id},data:{monthlyRate:1000}});
      await assert.rejects(saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now),/PREVIEW_CHANGED/);
      await db.configurationProfile.update({where:{id:f.profile.id},data:{config:{firstPeriod:"2026-11",proration:"FULL_MONTH",taxPercent:15,rentTaxable:true,insuranceEnabled:false,insuranceTaxable:false,charges:[],approvalReference:"Synthetic",discount:{name:"Temporary",type:"FIXED",value:100,startsPeriod:"2026-11",endsPeriod:"2026-12"}}}});
      await assert.rejects(previewCardAutopayRequest(f.session,f.account.id,schedule,now),/FIXED_AMOUNT_CHANGES/);
    });
    await t.test("unsigned leases, existing bank debit and prepaid credit require review",async()=>{
      const f=await fixture();await db.document.update({where:{id:f.document.id},data:{status:"DRAFT",signedAt:null}});
      await assert.rejects(previewCardAutopayRequest(f.session,f.account.id,schedule,now),/SIGNED_LEASE_REQUIRED/);
      await db.document.update({where:{id:f.document.id},data:{status:"SIGNED",signedAt:now}});
      await db.tenancy.update({where:{id:f.tenancy.id},data:{paymentMethod:"DEBIT_ORDER"}});await assert.rejects(previewCardAutopayRequest(f.session,f.account.id,schedule,now),/OTHER_COLLECTION_REVIEW/);
      await db.tenancy.update({where:{id:f.tenancy.id},data:{paymentMethod:"CARD"}});await db.account.update({where:{id:f.account.id},data:{balance:-950}});await assert.rejects(previewCardAutopayRequest(f.session,f.account.id,schedule,now),/PREPAID_REVIEW/);
    });
    await t.test("concurrent requests retain one request and one audit",async()=>{
      const f=await fixture();const p=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);
      const result=await Promise.allSettled([saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now),saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now)]);
      assert.ok(result.some(r=>r.status==="fulfilled"));assert.equal(await db.configurationProfile.count({where:{domain:"CARD_AUTOPAY_REQUEST",name:f.account.id}}),1);assert.equal(await db.auditEvent.count({where:{entityId:f.account.id,action:"card_autopay.request_recorded"}}),1);
    });
    await t.test("withdrawal is owned and idempotent, and never claims provider cancellation",async()=>{
      const f=await fixture();const p=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);const r=await saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now);
      await assert.rejects(withdrawCardAutopayRequest({...f.session,customerIds:[]},f.account.id,r.id),/TENANT_NOT_FOUND/);
      assert.equal((await withdrawCardAutopayRequest(f.session,f.account.id,r.id)).status,"WITHDRAWN");
      await withdrawCardAutopayRequest(f.session,f.account.id,r.id);assert.equal(await db.auditEvent.count({where:{entityId:f.account.id,action:"card_autopay.request_withdrawn"}}),1);
      await db.configurationProfile.update({where:{id:r.id},data:{status:"ACTIVE"}});
      await assert.rejects(withdrawCardAutopayRequest(f.session,f.account.id,r.id),/PROVIDER_CANCELLATION_REQUIRED/);
      assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:r.id}})).status,"ACTIVE");
    });
    await t.test("audit failure rolls back the request",async()=>{
      const f=await fixture();const p=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);
      await db.$executeRawUnsafe('CREATE FUNCTION reject_card_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = \'card_autopay.request_recorded\' THEN RAISE EXCEPTION \'synthetic audit failure\'; END IF; RETURN NEW; END $$');
      await db.$executeRawUnsafe('CREATE TRIGGER reject_card_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_card_audit()');
      try {await assert.rejects(saveCardAutopayRequest(f.session,f.account.id,schedule,p.fingerprint,true,now));assert.equal(await db.configurationProfile.count({where:{domain:"CARD_AUTOPAY_REQUEST",name:f.account.id}}),0);}
      finally {await db.$executeRawUnsafe('DROP TRIGGER reject_card_audit ON "AuditEvent"');await db.$executeRawUnsafe('DROP FUNCTION reject_card_audit()');}
    });
  } finally {await db.$disconnect();}
});

