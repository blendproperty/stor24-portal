import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {Prisma} from "../../src/generated/prisma/client";
import {db} from "../../src/lib/db";
import {saveStaffPriceContact,staffPriceContact,requestManagerPriceApproval,verifyManagerPriceApproval} from "../../src/lib/price-manager-service";
import {newPublicInitialRent,publicCheckoutTotal} from "../../src/lib/public-initial-rent";
import {newIdentityAccess} from "../../src/lib/identity-document-security";
import {decryptIntegrationSecret} from "../../src/lib/integrations/integration-secret-vault";
import {reservationDiscountReport,prepareStaffReservationQuote,proposeReservationPrice,decideReservationPrice,previewCustomerReservationPrice,acceptCustomerReservationPrice,reservationPriceWorkspace,appliedCustomerReservationPrice} from "../../src/lib/reservation-price-service";
import {preparePublicReservationLease,completePublicReservationLease} from "../../src/lib/public-lease-workflow";
import {visualReportSource} from "../../src/lib/visual-report-data";
import {defaultVisualQuery} from "../../src/lib/visual-report-engine";
import {southAfricaDateKey} from "../../src/lib/south-africa-time";
import {startPublicEmailVerification,emailVerificationHash,verifyPublicReservationEmail} from "../../src/lib/public-booking-service";
import {settleVerifiedBookingPayment} from "../../src/lib/payments/booking-payment-settlement";
import {startSimulatedPayment} from "../../src/lib/public-payment-simulator";
import {LEASE_CLAUSE_KEYS} from "../../src/lib/lease-agreement-content";

test("isolated governed price amendments preserve original quotes, consent, source locks and financial baselines",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const oldKey=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY,oldUrl=process.env.APP_URL;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString("hex");process.env.APP_URL="https://fixture.invalid";
  const organisations:string[]=[];
  async function fixture(){
    const access=newIdentityAccess();
    const org=await db.organisation.create({data:{name:"Synthetic governed quote",slug:randomUUID()}});organisations.push(org.id);
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic quote store",code:randomUUID()}});
    const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic",lastName:"Customer",email:randomUUID()+"@example.invalid",emailVerifiedAt:new Date(Date.now()-3600000)}});
    const proposer=await db.user.create({data:{organisationId:org.id,name:"Synthetic proposer",email:randomUUID()+"@example.invalid"}}),reviewer=await db.user.create({data:{organisationId:org.id,name:"Synthetic reviewer",email:randomUUID()+"@example.invalid"}});
    const role=await db.role.create({data:{organisationId:org.id,name:"Synthetic price authority",permissions:["reservation_prices.view","reservation_prices.propose","reservation_prices.approve","reservations.manage","billing.view"]}});
    await db.roleAssignment.createMany({data:[{userId:proposer.id,roleId:role.id,facilityId:facility.id},{userId:reviewer.id,roleId:role.id,facilityId:facility.id}]});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic quote unit"}}),unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"QUOTE-CI",floor:"Ground Floor",status:"RESERVED",monthlyRate:2000}});
    const moveIn=new Date(Date.now()+2*86400000),holdExpiresAt=new Date(Date.now()+86400000);
    const booking=await db.reservation.create({data:{facilityId:facility.id,customerId:customer.id,unitId:unit.id,status:"ACTIVE",journey:"RENTAL",source:"PUBLIC_VIEWING",publicReference:randomUUID(),quotedRate:1000,initialRentSnapshot:newPublicInitialRent(1000,moveIn),intendedMoveIn:moveIn,holdExpiresAt,contactVerifiedAt:new Date(),identityAccessHash:access.identityAccessHash,identityAccessExpiresAt:access.identityAccessExpiresAt}});
    const prepared=await preparePublicReservationLease(booking.publicReference!,"CARD",access.token);assert.ok(prepared.ok);
    // Suppress lifecycle delivery deliberately in this synthetic fixture. This is
    // not delivery evidence and never invokes an external email provider.
    const welcomeId=createHash("sha256").update(`${org.id}\0${customer.email}`).digest("hex");
    await db.tenantPortalWelcome.create({data:{id:welcomeId,organisationId:org.id,email:customer.email!,sentAt:new Date()}});
    const scope={organisationId:org.id,userId:proposer.id,facilityIds:[facility.id],unrestrictedFacilities:false};
    return {org,facility,customer,proposer,reviewer,unit,booking,scope,access};
  }
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const propose=(f:Fixture)=>({reservationId:f.booking.id,facilityId:f.facility.id,requestKey:randomUUID(),monthlyRate:"900.25",reason:"Synthetic agreed negotiation for independent review"});
  async function approve(f:Fixture,id:string){await decideReservationPrice({...f.scope,userId:f.reviewer.id},{id,facilityId:f.facility.id,revision:0,decision:"APPROVED",reference:"Synthetic independent price review",confirmed:true});}
  async function fresh(f:Fixture,id:string){
    await new Promise(resolve=>setTimeout(resolve,2));const access=newIdentityAccess(),verifiedAt=new Date();
    await db.reservation.update({where:{id:f.booking.id},data:{identityAccessHash:access.identityAccessHash,identityAccessExpiresAt:access.identityAccessExpiresAt}});
    await db.customer.update({where:{id:f.customer.id},data:{emailVerifiedAt:verifiedAt}});
    await db.auditEvent.create({data:{organisationId:f.org.id,facilityId:f.facility.id,entityType:"Reservation",entityId:f.booking.id,action:"public_reservation.email_verified",after:{verifiedAt:verifiedAt.toISOString()}}});
    const item=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id}});
    return {reference:f.booking.publicReference!,id,identityAccessToken:access.token,quoteFingerprint:item.quoteFingerprint,accepted:true as const,understandsNewAgreementRequired:true as const};
  }
  const financial=(f:Fixture)=>Promise.all([db.account.findMany({where:{customerId:f.customer.id},orderBy:{id:"asc"}}),db.payment.findMany({where:{account:{customerId:f.customer.id}},orderBy:{id:"asc"}}),db.ledgerEntry.findMany({where:{account:{customerId:f.customer.id}},orderBy:{id:"asc"}}),db.tenancy.findMany({where:{customerId:f.customer.id},orderBy:{id:"asc"}}),db.publicPaymentSession.findMany({where:{reservationId:f.booking.id},orderBy:{id:"asc"}})]);
  try{
    await t.test("manager WhatsApp codes bind the exact deal, operator session and current authority, and consume once without finance",async()=>{
      const keys=["AUTH_SECRET","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_WHATSAPP_FROM","TWILIO_WHATSAPP_PRICE_APPROVAL_SID"] as const,old=Object.fromEntries(keys.map(k=>[k,process.env[k]])),realFetch=globalThis.fetch;
      Object.assign(process.env,{AUTH_SECRET:"synthetic-price-otp-key-".repeat(3),TWILIO_ACCOUNT_SID:"AC"+"a".repeat(32),TWILIO_AUTH_TOKEN:"synthetic-token",TWILIO_WHATSAPP_FROM:"+27820000000",TWILIO_WHATSAPP_PRICE_APPROVAL_SID:"HX"+"b".repeat(32)});
      let lastCode="",sendCount=0;
      globalThis.fetch=async(input,init)=>{assert.equal(String(input),"https://api.twilio.com/2010-04-01/Accounts/"+process.env.TWILIO_ACCOUNT_SID+"/Messages.json");const fields=new URLSearchParams(String(init?.body));assert.equal(fields.get("To"),"whatsapp:+27821234567");lastCode=JSON.parse(fields.get("ContentVariables")!)["1"];sendCount++;return Response.json({sid:"SM"+"c".repeat(32)});};
      async function setup(){const f=await fixture(),proposal=await proposeReservationPrice(f.scope,propose(f));await saveStaffPriceContact(f.org.id,f.proposer.id,f.reviewer.id,{phone:"+27821234567",consent:true});const pending=await requestManagerPriceApproval(f.scope,{id:proposal.id,facilityId:f.facility.id,revision:0,approverId:f.reviewer.id,reference:"Synthetic manager approval",confirmed:true},"operator-session");const code=lastCode;return {...f,proposal,pending,code,verify:{challengeId:pending.challengeId,facilityId:f.facility.id,code,confirmed:true as const}};}
      try{
        const f=await setup(),before=await financial(f);assert.deepEqual(await staffPriceContact(f.org.id,f.reviewer.id),{configured:true,maskedPhone:"Ending 4567"});
        const retained=await db.priceApprovalChallenge.findUniqueOrThrow({where:{id:f.pending.challengeId}});assert.ok(!JSON.stringify(retained).includes(f.code));assert.equal(retained.status,"SENT");
        await assert.rejects(verifyManagerPriceApproval(f.scope,f.verify,"another-session"),/OTP_INVALID/);
        await assert.rejects(verifyManagerPriceApproval({...f.scope,userId:f.reviewer.id},f.verify,"operator-session"),/OTP_INVALID/);
        await assert.rejects(verifyManagerPriceApproval(f.scope,{...f.verify,code:f.code==="111111"?"222222":"111111"},"operator-session"),/OTP_INVALID/);
        assert.equal((await db.priceApprovalChallenge.findUniqueOrThrow({where:{id:retained.id}})).attempts,1);
        const result=await Promise.allSettled([verifyManagerPriceApproval(f.scope,f.verify,"operator-session"),verifyManagerPriceApproval(f.scope,f.verify,"operator-session")]);assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
        const approved=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:f.proposal.id}});assert.equal(approved.status,"APPROVED");assert.equal(approved.reviewedById,f.reviewer.id);assert.deepEqual(await financial(f),before);assert.equal((await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}})).quotedRate.toFixed(2),"1000.00");
        const event=await db.auditEvent.findFirstOrThrow({where:{entityId:f.proposal.id,action:"reservation.price_approved"}});assert.equal(event.actorId,f.reviewer.id);assert.equal((event.after as {requestedById:string}).requestedById,f.proposer.id);assert.ok(!JSON.stringify(event).includes(f.code));
        const revoked=await setup();await db.user.update({where:{id:revoked.reviewer.id},data:{sessionVersion:{increment:1}}});await assert.rejects(verifyManagerPriceApproval(revoked.scope,revoked.verify,"operator-session"),/OTP_INVALID/);
        const permission=await setup();const assignment=await db.roleAssignment.findFirstOrThrow({where:{userId:permission.reviewer.id}});await db.role.update({where:{id:assignment.roleId},data:{permissions:["reservation_prices.view"]}});await assert.rejects(verifyManagerPriceApproval(permission.scope,permission.verify,"operator-session"),/FORBIDDEN/);
        const changed=await setup();await db.reservationPriceAmendment.update({where:{id:changed.proposal.id},data:{revision:{increment:1}}});await assert.rejects(verifyManagerPriceApproval(changed.scope,changed.verify,"operator-session"),/SOURCE_CHANGED/);
        const contact=await setup();await saveStaffPriceContact(contact.org.id,contact.proposer.id,contact.reviewer.id,{phone:"",consent:true});await assert.rejects(verifyManagerPriceApproval(contact.scope,contact.verify,"operator-session"),/OTP_INVALID/);
        const expired=await setup();await db.priceApprovalChallenge.update({where:{id:expired.pending.challengeId},data:{expiresAt:new Date(0)}});await assert.rejects(verifyManagerPriceApproval(expired.scope,expired.verify,"operator-session"),/OTP_INVALID/);
        const exhausted=await setup();await db.priceApprovalChallenge.update({where:{id:exhausted.pending.challengeId},data:{attempts:5}});await assert.rejects(verifyManagerPriceApproval(exhausted.scope,exhausted.verify,"operator-session"),/OTP_INVALID/);
        const pending=await setup(),account=await db.account.create({data:{customerId:pending.customer.id,accountNumber:`ST24-T-${pending.booking.id}`}});await db.payment.create({data:{accountId:account.id,amount:1000,currency:"ZAR",method:"PAY_NOW",provider:"NETCASH",providerRef:randomUUID(),status:"PENDING",idempotencyKey:randomUUID()}});const financialBefore=await financial(pending);await assert.rejects(verifyManagerPriceApproval(pending.scope,pending.verify,"operator-session"),/REVIEW_REQUIRED/);assert.deepEqual(await financial(pending),financialBefore);assert.equal((await db.priceApprovalChallenge.findUniqueOrThrow({where:{id:pending.pending.challengeId}})).status,"SENT");
        const rollback=await setup(),constraint="price_otp_"+randomUUID().replaceAll("-","");assert.match(rollback.org.id,/^[a-z0-9]+$/);await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK ("organisationId" <> '${rollback.org.id}' OR "action" <> 'reservation.price_approved') NOT VALID`);try{await assert.rejects(verifyManagerPriceApproval(rollback.scope,rollback.verify,"operator-session"));}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`);}assert.equal((await db.priceApprovalChallenge.findUniqueOrThrow({where:{id:rollback.pending.challengeId}})).status,"SENT");assert.equal((await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:rollback.proposal.id}})).status,"PROPOSED");
        const limited=await setup(),sent=sendCount;await assert.rejects(requestManagerPriceApproval(limited.scope,{id:limited.proposal.id,facilityId:limited.facility.id,revision:0,approverId:limited.reviewer.id,reference:"Duplicate send blocked",confirmed:true},"operator-session"),/OTP_LIMIT/);assert.equal(sendCount,sent);
        const noConfig=await fixture(),proposal=await proposeReservationPrice(noConfig.scope,propose(noConfig));delete process.env.TWILIO_WHATSAPP_PRICE_APPROVAL_SID;const count=sendCount;await assert.rejects(requestManagerPriceApproval(noConfig.scope,{id:proposal.id,facilityId:noConfig.facility.id,revision:0,approverId:noConfig.reviewer.id,reference:"No configured template",confirmed:true},"operator-session"),/CONFIG_REQUIRED/);assert.equal(sendCount,count);
      }finally{globalThis.fetch=realFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
    });
    await t.test("campaign reasons are scoped, current and snapshotted without granting a price or changing finance",async()=>{
      const f=await fixture(),other=await fixture(),now=new Date();
      const campaign=await db.marketingCampaign.create({data:{organisationId:f.org.id,facilityId:f.facility.id,name:"Summer campaign",source:"OTHER",medium:"PROMOTION",budget:0,status:"ACTIVE",startsAt:new Date(now.getTime()-86400000)}});
      const foreign=await db.marketingCampaign.create({data:{organisationId:other.org.id,facilityId:other.facility.id,name:"Other store private campaign",source:"OTHER",medium:"PROMOTION",budget:0,status:"ACTIVE",startsAt:new Date(0)}});
      assert.deepEqual((await reservationPriceWorkspace(f.scope,f.booking.id)).campaigns,[{id:campaign.id,name:"Summer campaign"}]);
      await assert.rejects(proposeReservationPrice(f.scope,{...propose(f),reasonSelection:{type:"CAMPAIGN",campaignId:foreign.id}}),/CAMPAIGN_UNAVAILABLE/);
      for(const patch of [{status:"PLANNED"},{status:"PAUSED"},{status:"COMPLETE"},{startsAt:new Date(now.getTime()+86400000)},{endsAt:new Date(now.getTime()-86400000)}]){
        await db.marketingCampaign.update({where:{id:campaign.id},data:{status:"ACTIVE",startsAt:new Date(0),endsAt:null,...patch}});
        assert.deepEqual((await reservationPriceWorkspace(f.scope,f.booking.id)).campaigns,[]);
        await assert.rejects(proposeReservationPrice(f.scope,{...propose(f),reasonSelection:{type:"CAMPAIGN",campaignId:campaign.id}}),/CAMPAIGN_UNAVAILABLE/);
      }
      await db.marketingCampaign.update({where:{id:campaign.id},data:{startsAt:new Date(0),endsAt:null}});
      const before=await financial(f),proposal=await proposeReservationPrice(f.scope,{...propose(f),reason:"Spoofed client campaign description",reasonSelection:{type:"CAMPAIGN",campaignId:campaign.id}});
      const row=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:proposal.id}}),saved=JSON.parse(decryptIntegrationSecret(row.proposedEncrypted));
      assert.equal(row.status,"PROPOSED");assert.equal(saved.reason,"Promotion campaign: Summer campaign");assert.deepEqual(saved.reasonSelection,{type:"CAMPAIGN",campaignId:campaign.id,campaignName:"Summer campaign"});
      await db.marketingCampaign.update({where:{id:campaign.id},data:{name:"Renamed campaign"}});
      assert.equal((await reservationPriceWorkspace(f.scope,f.booking.id)).amendments[0].reason,"Promotion campaign: Summer campaign");assert.deepEqual(await financial(f),before);
      const manual=await fixture(),unlisted=await proposeReservationPrice(manual.scope,{...propose(manual),reasonSelection:{type:"OTHER_CAMPAIGN",campaignName:"Unlisted summer offer"}});
      assert.equal(JSON.parse(decryptIntegrationSecret((await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:unlisted.id}})).proposedEncrypted)).reason,"Promotion campaign (not listed): Unlisted summer offer");
      const custom=await fixture(),record=await proposeReservationPrice(custom.scope,{...propose(custom),reasonSelection:{type:"OTHER",explanation:"Customer circumstances explained"}});
      assert.equal(JSON.parse(decryptIntegrationSecret((await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:record.id}})).proposedEncrypted)).reason,"Other: Customer circumstances explained");
    });
    await t.test("unsigned unpaid online rental quotes can propose without changing financial records",async()=>{
      const f=await fixture();await db.reservation.update({where:{id:f.booking.id},data:{source:"PUBLIC_WEBSITE"}});const before=await financial(f);const item=await proposeReservationPrice(f.scope,propose(f));assert.ok(item.id);assert.deepEqual(await financial(f),before);
    });
    await t.test("Pay now confirmed declines allow a proposal but pending/successful/uncertain payments and changed evidence block acceptance",async()=>{
      const f=await fixture();await db.reservation.update({where:{id:f.booking.id},data:{source:"PUBLIC_WEBSITE"}});
      const account=await db.account.create({data:{customerId:f.customer.id,accountNumber:`ST24-T-${f.booking.id}`}});
      const payment=await db.payment.create({data:{accountId:account.id,amount:1000,currency:"ZAR",method:"PAY_NOW",provider:"NETCASH",providerRef:randomUUID(),environment:"live",status:"FAILED",failureCode:"DECLINED",processedAt:new Date(),idempotencyKey:randomUUID()}});
      const session=await db.publicPaymentSession.create({data:{reservationId:f.booking.id,amount:1000,description:"Synthetic terminal decline",checkoutTokenHash:"a".repeat(64),idempotencyKey:randomUUID(),providerReference:randomUUID(),expiresAt:new Date(Date.now()+3600000),status:"DECLINED",failureCode:"DECLINED",processedAt:new Date()}});
      for(const patch of [{status:"PENDING"},{status:"TEST_PENDING"},{status:"SUCCEEDED"},{status:"TEST_SUCCEEDED"},{status:"REFUNDED"},{status:"FAILED",failureCode:"TIMEOUT"},{status:"FAILED",failureCode:"CHECKOUT_CREATE_FAILED"},{status:"FAILED",failureCode:"DECLINED",processedAt:null}] as Prisma.PaymentUpdateInput[]){
        await db.payment.update({where:{id:payment.id},data:{status:"FAILED",failureCode:"DECLINED",processedAt:new Date(),...patch}});
        await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/REVIEW_REQUIRED/);
      }
      await db.payment.update({where:{id:payment.id},data:{status:"FAILED",failureCode:"DECLINED",processedAt:new Date()}});
      for(const status of ["PENDING","SUCCEEDED","TIMEOUT","CANCELLED","UNKNOWN"]){await db.publicPaymentSession.update({where:{id:session.id},data:{status}});await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/REVIEW_REQUIRED/);}
      await db.publicPaymentSession.update({where:{id:session.id},data:{status:"DECLINED"}});
      const before=await financial(f),proposal=await proposeReservationPrice(f.scope,propose(f));
      await approve(f,proposal.id);const consent=await fresh(f,proposal.id);
      assert.deepEqual(await financial(f),before);
      await db.payment.update({where:{id:payment.id},data:{status:"PENDING"}});
      await assert.rejects(acceptCustomerReservationPrice(consent),/REVIEW_REQUIRED/);
      await db.payment.update({where:{id:payment.id},data:{status:"FAILED"}});
      const beforeAcceptance=await financial(f);
      await acceptCustomerReservationPrice(consent);
      assert.deepEqual(await financial(f),beforeAcceptance);
      assert.equal((await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}})).quotedRate.toFixed(2),"900.25");
      await assert.rejects(settleVerifiedBookingPayment(payment.id,{reference:payment.providerRef!,amount:1000,accepted:true,requestTrace:"Synthetic late callback"}),/QUOTE_CHANGED/);
      assert.deepEqual(await financial(f),beforeAcceptance);
    });
    await t.test("checkout starts on the current quote and a newly pending session blocks price proposals",async()=>{
      const f=await fixture();await db.reservation.update({where:{id:f.booking.id},data:{source:"PUBLIC_WEBSITE"}});
      const previous=process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED;process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED="true";
      try{
        const started=await startSimulatedPayment(f.booking.publicReference!,randomUUID(),f.access.token);assert.ok(started.ok);
        if(!started.ok)throw Error("Synthetic checkout failed");assert.equal(started.amountZar,publicCheckoutTotal(f.booking));
        await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/REVIEW_REQUIRED/);
      }finally{if(previous===undefined)delete process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED;else process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED=previous;}
    });
    await t.test("a verified viewing hold needs an agreed date and explicit rental preparation without extending its hold",async()=>{
      const f=await fixture();await db.publicReservationLease.delete({where:{reservationId:f.booking.id}});
      await db.reservation.update({where:{id:f.booking.id},data:{journey:"VIEWING",intendedMoveIn:null,initialRentSnapshot:Prisma.DbNull}});
      const view=await reservationPriceWorkspace(f.scope,f.booking.id),input={reservationId:f.booking.id,facilityId:f.facility.id,sourceFingerprint:view.preparation!.sourceFingerprint,confirmed:true};
      await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/REVIEW_REQUIRED/);
      await assert.rejects(prepareStaffReservationQuote(f.scope,input),/INVALID/);
      await prepareStaffReservationQuote(f.scope,{...input,intendedMoveIn:southAfricaDateKey(new Date(Date.now()+86400000))});
      const current=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}});assert.equal(current.journey,"VIEWING");assert.equal(current.source,"PUBLIC_VIEWING");assert.equal(current.holdExpiresAt!.getTime(),f.booking.holdExpiresAt!.getTime());assert.equal(current.quotedRate.toFixed(2),"1000.00");
      const proposal=await proposeReservationPrice(f.scope,propose(f));
      const oldEnabled=process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED,oldProvider=process.env.EMAIL_PROVIDER;
      process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED="true";process.env.EMAIL_PROVIDER="disabled";
      assert.ok(!process.env.TWILIO_ACCOUNT_SID,"Synthetic quote test forbids external fallback transport");
      try{
        const unavailable=await startPublicEmailVerification(f.booking.publicReference!,true,proposal.id);assert.equal(unavailable.ok,false);assert.ok("code" in unavailable&&unavailable.code==="NOT_FOUND");
        await approve(f,proposal.id);
        const challenge=await startPublicEmailVerification(f.booking.publicReference!,true,proposal.id);assert.equal(challenge.ok,false);assert.ok("code" in challenge&&challenge.code==="DELIVERY_FAILED");
        const challenged=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}});assert.ok(challenged.verificationCodeHash);assert.equal(challenged.journey,"VIEWING");assert.equal(challenged.holdExpiresAt!.getTime(),f.booking.holdExpiresAt!.getTime());
      }finally{if(oldEnabled===undefined)delete process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED;else process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED=oldEnabled;if(oldProvider===undefined)delete process.env.EMAIL_PROVIDER;else process.env.EMAIL_PROVIDER=oldProvider;}
      await acceptCustomerReservationPrice(await fresh(f,proposal.id));assert.equal((await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}})).journey,"RENTAL");
    });
    await t.test("staff quote preparation retains the real original, discounts are checked server-side and fresh email proof precedes acceptance",async()=>{
      const f=await fixture();
      await db.publicReservationLease.delete({where:{reservationId:f.booking.id}});
      await db.reservation.update({where:{id:f.booking.id},data:{source:"INTERNAL",initialRentSnapshot:Prisma.DbNull,publicReference:null,contactVerifiedAt:null}});
      await db.customer.update({where:{id:f.customer.id},data:{emailVerifiedAt:null}});
      const baseline=await financial(f),input={reservationId:f.booking.id,facilityId:f.facility.id,sourceFingerprint:(await reservationPriceWorkspace(f.scope,f.booking.id)).preparation!.sourceFingerprint,confirmed:true as const};
      await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/REVIEW_REQUIRED/);
      await assert.rejects(prepareStaffReservationQuote({...f.scope,facilityIds:[]},input),/NOT_FOUND/);
      await assert.rejects(prepareStaffReservationQuote(f.scope,{...input,sourceFingerprint:"a".repeat(64)}),/SOURCE_CHANGED/);
      await prepareStaffReservationQuote(f.scope,input);await prepareStaffReservationQuote(f.scope,input);
      const prepared=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}});
      assert.ok(prepared.publicReference);assert.equal(prepared.contactVerifiedAt,null);assert.equal(prepared.source,"INTERNAL");assert.equal(prepared.quotedRate.toFixed(2),"1000.00");
      assert.equal(await db.auditEvent.count({where:{entityId:f.booking.id,action:"reservation.price_staff_quote_prepared"}}),1);
      const evidence=await db.auditEvent.findFirstOrThrow({where:{entityId:f.booking.id,action:"reservation.price_staff_quote_prepared"}});
      const retained=JSON.parse(decryptIntegrationSecret((evidence.after as {originalEncrypted:string}).originalEncrypted));assert.equal(retained.initialRentSnapshot,null);assert.equal(retained.quotedRate,"1000.00");
      assert.deepEqual(prepared.initialRentSnapshot,newPublicInitialRent(1000,prepared.intendedMoveIn!));
      await assert.rejects(proposeReservationPrice(f.scope,{...propose(f),monthlyRate:"800",adjustment:{mode:"DISCOUNT_PERCENT",value:"10"}}),/INVALID/);
      const proposal=await proposeReservationPrice(f.scope,{...propose(f),monthlyRate:"900.00",adjustment:{mode:"DISCOUNT_PERCENT",value:"10"}});await approve(f,proposal.id);
      const oldEnabled=process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED,oldPublicKey=process.env.PUBLIC_BOOKING_API_KEY;
      process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED="true";process.env.PUBLIC_BOOKING_API_KEY="isolated-synthetic-staff-quote";
      try{
        await new Promise(resolve=>setTimeout(resolve,5));
        await db.reservation.update({where:{id:f.booking.id},data:{verificationCodeHash:emailVerificationHash(f.booking.id,"123456"),verificationExpiresAt:new Date(Date.now()+60000)}});
        assert.equal((await verifyPublicReservationEmail(prepared.publicReference!,"123456")).ok,false);
        assert.equal((await verifyPublicReservationEmail(prepared.publicReference!,"123456","wrong-proposal")).ok,false);
        assert.equal((await verifyPublicReservationEmail(prepared.publicReference!,"111111",proposal.id)).ok,false);
        assert.equal((await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}})).contactVerifiedAt,null);
        const verified=await verifyPublicReservationEmail(prepared.publicReference!,"123456",proposal.id);assert.ok(verified.ok&&"identityAccessToken" in verified);
        if(!verified.ok||!("identityAccessToken" in verified))throw Error("Synthetic verification failed");
        const view=await previewCustomerReservationPrice(prepared.publicReference!,verified.identityAccessToken,proposal.id);assert.equal(view.monthlyRate,"900.00");
        await acceptCustomerReservationPrice({reference:prepared.publicReference!,id:proposal.id,identityAccessToken:verified.identityAccessToken,quoteFingerprint:view.quoteFingerprint,accepted:true,understandsNewAgreementRequired:true});
        const agreement=await preparePublicReservationLease(prepared.publicReference!,"EFT",verified.identityAccessToken);assert.ok(agreement.ok);
        const lease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}});assert.equal(lease.status,"READY");assert.equal(lease.signedAt,null);assert.match(lease.content,/900/);
        assert.deepEqual(await financial(f),baseline);
      }finally{if(oldEnabled===undefined)delete process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED;else process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED=oldEnabled;if(oldPublicKey===undefined)delete process.env.PUBLIC_BOOKING_API_KEY;else process.env.PUBLIC_BOOKING_API_KEY=oldPublicKey;}
    });
    await t.test("concurrent proposals are idempotent, originals immutable and authorised own-proposal approval does not change the booking",async()=>{
      const f=await fixture(),input=propose(f),before=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),baseline=await financial(f);
      const [first,retry]=await Promise.all([proposeReservationPrice(f.scope,input),proposeReservationPrice(f.scope,input)]);assert.equal(first.id,retry.id);
      assert.equal(await db.reservationPriceAmendment.count({where:{reservationId:f.booking.id}}),1);
      await assert.rejects(proposeReservationPrice(f.scope,{...input,monthlyRate:"800"}),/CONFLICT/);
      await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/PENDING_EXISTS/);
      const item=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:first.id}}),original=JSON.parse(decryptIntegrationSecret(item.originalEncrypted));
      assert.equal(original.quotedRate,"1000.00");assert.deepEqual(original.initialRentSnapshot,before.initialRentSnapshot);assert.ok(original.lease.content);assert.ok(!item.originalEncrypted.includes("Synthetic Customer"));
      await assert.rejects(db.reservationPriceAmendment.update({where:{id:item.id},data:{originalEncrypted:"not-an-original"}}));
      await decideReservationPrice(f.scope,{id:item.id,facilityId:f.facility.id,revision:0,decision:"APPROVED",reference:"Authorised own proposal approval",confirmed:true});
      const approved=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:item.id}});assert.equal(approved.reviewedById,f.proposer.id);assert.match(approved.reviewReference!,/^Synthetic proposer \| APPROVED \|/);assert.ok(!approved.reviewReference!.includes("Authorised own proposal approval"));assert.ok(approved.reviewedAt);assert.deepEqual(await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),before);assert.deepEqual(await financial(f),baseline);
      assert.equal((await reservationPriceWorkspace(f.scope,f.booking.publicReference!)).amendments.length,1);
      const report=await reservationDiscountReport(f.scope,{reportKey:"booking-discounts",from:southAfricaDateKey(new Date()),to:southAfricaDateKey(new Date()),format:"CSV",groupBy:"month"});const row=report.find(r=>r.proposalId===item.id)!;assert.equal(row.approvedBy,f.proposer.name);assert.equal(row.originalMonthlyRent,"1000.00");assert.equal(row.proposedMonthlyRent,"900.25");assert.equal(row.discountRand,"99.75");assert.equal(row.issue,null);assert.deepEqual(await reservationDiscountReport({...f.scope,facilityIds:[]},{reportKey:"booking-discounts",from:southAfricaDateKey(new Date()),to:southAfricaDateKey(new Date()),format:"CSV",groupBy:"month"}),[]);
      await assert.rejects(reservationPriceWorkspace({...f.scope,facilityIds:[]},f.booking.publicReference!),/NOT_FOUND/);
    });
    await t.test("customer acceptance needs fresh booking-specific proof and changes one quote exactly once with original signing link invalidated",async()=>{
      const f=await fixture(),oldLease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}}),proposal=await proposeReservationPrice(f.scope,propose(f));await approve(f,proposal.id);
      const stale=newIdentityAccess();await db.reservation.update({where:{id:f.booking.id},data:{identityAccessHash:stale.identityAccessHash,identityAccessExpiresAt:stale.identityAccessExpiresAt}});
      await assert.rejects(previewCustomerReservationPrice(f.booking.publicReference!,stale.token,proposal.id),/FRESH_VERIFICATION/);
      const acceptance=await fresh(f,proposal.id),baseline=await financial(f),preview=await previewCustomerReservationPrice(f.booking.publicReference!,acceptance.identityAccessToken,proposal.id);
      assert.equal(preview.previousMonthlyRate,"1000.00");assert.equal(preview.monthlyRate,"900.25");
      await assert.rejects(acceptCustomerReservationPrice({...acceptance,quoteFingerprint:"a".repeat(64)}),/SOURCE_CHANGED/);
      const results=await Promise.all([acceptCustomerReservationPrice(acceptance),acceptCustomerReservationPrice(acceptance)]);assert.equal(results.filter(r=>!r.idempotent).length,1);
      const current=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}});assert.equal(current.quotedRate.toFixed(2),"900.25");assert.deepEqual(current.initialRentSnapshot,newPublicInitialRent(900.25,current.intendedMoveIn!));assert.ok(publicCheckoutTotal(current)>0);
      assert.equal(await db.publicReservationLease.count({where:{signingToken:oldLease.signingToken}}),0);assert.equal((await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}})).status,"REQUOTE_REQUIRED");
      assert.deepEqual(await financial(f),baseline);assert.equal(await db.auditEvent.count({where:{entityId:proposal.id,action:"reservation.price_customer_accepted"}}),1);
      assert.equal((await previewCustomerReservationPrice(f.booking.publicReference!,acceptance.identityAccessToken,proposal.id)).applied,true);
      await appliedCustomerReservationPrice(f.booking.publicReference!,acceptance.identityAccessToken,proposal.id);
      const original=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:proposal.id}});assert.equal(JSON.parse(decryptIntegrationSecret(original.originalEncrypted)).quotedRate,"1000.00");
      await assert.rejects(db.reservationPriceAmendment.update({where:{id:proposal.id},data:{status:"WITHDRAWN"}}));
      const regenerated=await preparePublicReservationLease(f.booking.publicReference!,"EFT",acceptance.identityAccessToken);assert.ok(regenerated.ok);const newLease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}});assert.equal(newLease.status,"READY");assert.equal(newLease.paymentMethod,"EFT");assert.notEqual(newLease.sha256,oldLease.sha256);assert.equal(newLease.signedAt,null);
    });
    await t.test("native cohort source retains the first original across two real accepted quotes and holds broken consent evidence",async()=>{
      const f=await fixture(),yesterday=southAfricaDateKey(new Date(Date.now()-86400000)),today=southAfricaDateKey(new Date());
      const lead=await db.lead.create({data:{facilityId:f.facility.id,customerId:f.customer.id,source:"PUBLIC_QUOTE_FORM",createdAt:new Date(`${yesterday}T10:00:00+02:00`)}});
      await db.reservation.update({where:{id:f.booking.id},data:{leadId:lead.id}});
      const baseline=await financial(f),query={...defaultVisualQuery("marketing-payment-cohorts",yesterday,today),facilityId:f.facility.id};
      const first=await proposeReservationPrice(f.scope,propose(f));await approve(f,first.id);await acceptCustomerReservationPrice(await fresh(f,first.id));
      await new Promise(resolve=>setTimeout(resolve,2));
      const second=await proposeReservationPrice(f.scope,{...propose(f),monthlyRate:"850.00"});await approve(f,second.id);await acceptCustomerReservationPrice(await fresh(f,second.id));
      const row=(await visualReportSource(f.scope,query)).find(r=>r.enquiry===lead.id)!;
      assert.equal(row.originalMonthlyQuote,"1000.00");assert.equal(row.latestAcceptedQuote,"850.00");assert.equal(row.acceptedPriceChanges,2);assert.equal(row.review,null);
      const earlier=(await visualReportSource(f.scope,{...query,to:yesterday})).find(r=>r.enquiry===lead.id)!;assert.equal(earlier.originalMonthlyQuote,"1000.00");assert.equal(earlier.acceptedPriceChanges,0);assert.equal(earlier.latestAcceptedQuote,null);
      await db.auditEvent.updateMany({where:{entityId:second.id,action:"reservation.price_customer_accepted"},data:{action:"synthetic.missing_acceptance"}});
      const held=(await visualReportSource(f.scope,query)).find(r=>r.enquiry===lead.id)!;assert.equal(held.originalMonthlyQuote,null);assert.equal(held.latestAcceptedQuote,null);assert.equal(held.paymentOutcome,"REVIEW_REQUIRED");
      await assert.rejects(visualReportSource(f.scope,{...query,groupBy:["currency"],metrics:[{field:"latestAcceptedQuote",operation:"sum"}]}),/REPORT_COHORT_REVIEW/);
      assert.deepEqual(await financial(f),baseline);
    });
    await t.test("changed original evidence and existing signed or payment records hold amendments",async()=>{
      const f=await fixture(),proposal=await proposeReservationPrice(f.scope,propose(f));
      await db.reservation.update({where:{id:f.booking.id},data:{quotedRate:999}});await assert.rejects(approve(f,proposal.id),/REVIEW_REQUIRED|SOURCE_CHANGED/);
      const paid=await fixture();await db.publicPaymentSession.create({data:{reservationId:paid.booking.id,amount:1000,description:"Synthetic prior attempt",checkoutTokenHash:"a".repeat(64),idempotencyKey:randomUUID(),providerReference:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});await assert.rejects(proposeReservationPrice(paid.scope,propose(paid)),/REVIEW_REQUIRED/);
      const signed=await fixture();await db.publicReservationLease.update({where:{reservationId:signed.booking.id},data:{status:"SIGNED",signedAt:new Date()}});await assert.rejects(proposeReservationPrice(signed.scope,propose(signed)),/REVIEW_REQUIRED/);
    });
    await t.test("acceptance audit failure rolls back price, unsigned document and amendment state",async()=>{
      const f=await fixture(),proposal=await proposeReservationPrice(f.scope,propose(f));await approve(f,proposal.id);const acceptance=await fresh(f,proposal.id);
      const before=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),lease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}}),baseline=await financial(f);
      const constraint="price_accept_"+randomUUID().replaceAll("-","");assert.match(f.org.id,/^[a-z0-9]+$/);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK ("organisationId" <> '${f.org.id}' OR "action" <> 'reservation.price_customer_accepted') NOT VALID`);
      try{await assert.rejects(acceptCustomerReservationPrice(acceptance));}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`);}
      assert.deepEqual(await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),before);assert.deepEqual(await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}}),lease);assert.deepEqual(await financial(f),baseline);assert.equal((await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:proposal.id}})).status,"APPROVED");
    });
    await t.test("actual signing and price acceptance serialize and cannot both accept different particulars",async()=>{
      const f=await fixture(),lease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}}),proposal=await proposeReservationPrice(f.scope,propose(f));await approve(f,proposal.id);const acceptance=await fresh(f,proposal.id),baseline=await financial(f);
      const result=await Promise.allSettled([completePublicReservationLease(lease.signingToken,{signerName:"Synthetic Customer",initials:[...LEASE_CLAUSE_KEYS],signerIp:null,signerUserAgent:"synthetic-ci",termsAccepted:true,acceptedSha256:lease.sha256}),acceptCustomerReservationPrice(acceptance)]);
      assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
      const current=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),currentLease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}});
      if(currentLease.status==="SIGNED")assert.equal(current.quotedRate.toFixed(2),"1000.00");else{assert.equal(current.quotedRate.toFixed(2),"900.25");assert.equal(currentLease.status,"REQUOTE_REQUIRED");}
      assert.deepEqual(await financial(f),baseline);
    });
  }finally{
    for(const organisationId of organisations){
      await db.reservationPriceAmendment.deleteMany({where:{organisationId}});await db.auditEvent.deleteMany({where:{organisationId}});await db.tenantPortalWelcome.deleteMany({where:{organisationId}});
      await db.publicPaymentSession.deleteMany({where:{reservation:{customer:{organisationId}}}});await db.publicReservationLease.deleteMany({where:{reservation:{customer:{organisationId}}}});await db.reservation.deleteMany({where:{customer:{organisationId}}});await db.payment.deleteMany({where:{account:{customer:{organisationId}}}});await db.account.deleteMany({where:{customer:{organisationId}}});await db.marketingCampaign.deleteMany({where:{organisationId}});await db.organisation.delete({where:{id:organisationId}});
    }
    if(oldKey===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=oldKey;if(oldUrl===undefined)delete process.env.APP_URL;else process.env.APP_URL=oldUrl;await db.$disconnect();
  }
});
