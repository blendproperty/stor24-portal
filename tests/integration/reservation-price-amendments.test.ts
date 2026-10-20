import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {Prisma} from "../../src/generated/prisma/client";
import {db} from "../../src/lib/db";
import {newPublicInitialRent,publicCheckoutTotal} from "../../src/lib/public-initial-rent";
import {newIdentityAccess} from "../../src/lib/identity-document-security";
import {decryptIntegrationSecret} from "../../src/lib/integrations/integration-secret-vault";
import {prepareStaffReservationQuote,proposeReservationPrice,decideReservationPrice,previewCustomerReservationPrice,acceptCustomerReservationPrice,reservationPriceWorkspace,appliedCustomerReservationPrice} from "../../src/lib/reservation-price-service";
import {preparePublicReservationLease,completePublicReservationLease} from "../../src/lib/public-lease-workflow";
import {visualReportSource} from "../../src/lib/visual-report-data";
import {defaultVisualQuery} from "../../src/lib/visual-report-engine";
import {southAfricaDateKey} from "../../src/lib/south-africa-time";
import {emailVerificationHash,verifyPublicReservationEmail} from "../../src/lib/public-booking-service";
import {LEASE_CLAUSE_KEYS} from "../../src/lib/lease-agreement-content";

test("isolated governed price amendments preserve original quotes, consent, source locks and financial baselines",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const oldKey=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY,oldUrl=process.env.APP_URL;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString("hex");process.env.APP_URL="https://fixture.invalid";
  const organisations:string[]=[];
  async function fixture(){
    const org=await db.organisation.create({data:{name:"Synthetic governed quote",slug:randomUUID()}});organisations.push(org.id);
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic quote store",code:randomUUID()}});
    const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic",lastName:"Customer",email:randomUUID()+"@example.invalid",emailVerifiedAt:new Date(Date.now()-3600000)}});
    const proposer=await db.user.create({data:{organisationId:org.id,name:"Synthetic proposer",email:randomUUID()+"@example.invalid"}}),reviewer=await db.user.create({data:{organisationId:org.id,name:"Synthetic reviewer",email:randomUUID()+"@example.invalid"}});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic quote unit"}}),unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"QUOTE-CI",floor:"Ground Floor",status:"RESERVED",monthlyRate:2000}});
    const moveIn=new Date(Date.now()+2*86400000),holdExpiresAt=new Date(Date.now()+86400000);
    const booking=await db.reservation.create({data:{facilityId:facility.id,customerId:customer.id,unitId:unit.id,status:"ACTIVE",journey:"RENTAL",source:"PUBLIC_WEBSITE",publicReference:randomUUID(),quotedRate:1000,initialRentSnapshot:newPublicInitialRent(1000,moveIn),intendedMoveIn:moveIn,holdExpiresAt,contactVerifiedAt:new Date()}});
    const prepared=await preparePublicReservationLease(booking.publicReference!,"CARD");assert.ok(prepared.ok);
    // Suppress lifecycle delivery deliberately in this synthetic fixture. This is
    // not delivery evidence and never invokes an external email provider.
    const welcomeId=createHash("sha256").update(`${org.id}\0${customer.email}`).digest("hex");
    await db.tenantPortalWelcome.create({data:{id:welcomeId,organisationId:org.id,email:customer.email!,sentAt:new Date()}});
    const scope={organisationId:org.id,userId:proposer.id,facilityIds:[facility.id],unrestrictedFacilities:false};
    return {org,facility,customer,proposer,reviewer,unit,booking,scope};
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
        const agreement=await preparePublicReservationLease(prepared.publicReference!,"EFT");assert.ok(agreement.ok);
        const lease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}});assert.equal(lease.status,"READY");assert.equal(lease.signedAt,null);assert.match(lease.content,/900/);
        assert.deepEqual(await financial(f),baseline);
      }finally{if(oldEnabled===undefined)delete process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED;else process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED=oldEnabled;if(oldPublicKey===undefined)delete process.env.PUBLIC_BOOKING_API_KEY;else process.env.PUBLIC_BOOKING_API_KEY=oldPublicKey;}
    });
    await t.test("concurrent proposals are idempotent, originals immutable and independent approval does not change the booking",async()=>{
      const f=await fixture(),input=propose(f),before=await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),baseline=await financial(f);
      const [first,retry]=await Promise.all([proposeReservationPrice(f.scope,input),proposeReservationPrice(f.scope,input)]);assert.equal(first.id,retry.id);
      assert.equal(await db.reservationPriceAmendment.count({where:{reservationId:f.booking.id}}),1);
      await assert.rejects(proposeReservationPrice(f.scope,{...input,monthlyRate:"800"}),/CONFLICT/);
      await assert.rejects(proposeReservationPrice(f.scope,propose(f)),/PENDING_EXISTS/);
      const item=await db.reservationPriceAmendment.findUniqueOrThrow({where:{id:first.id}}),original=JSON.parse(decryptIntegrationSecret(item.originalEncrypted));
      assert.equal(original.quotedRate,"1000.00");assert.deepEqual(original.initialRentSnapshot,before.initialRentSnapshot);assert.ok(original.lease.content);assert.ok(!item.originalEncrypted.includes("Synthetic Customer"));
      await assert.rejects(db.reservationPriceAmendment.update({where:{id:item.id},data:{originalEncrypted:"not-an-original"}}));
      await assert.rejects(decideReservationPrice(f.scope,{id:item.id,facilityId:f.facility.id,revision:0,decision:"APPROVED",reference:"Invalid self approval",confirmed:true}),/INDEPENDENT/);
      await approve(f,item.id);assert.deepEqual(await db.reservation.findUniqueOrThrow({where:{id:f.booking.id}}),before);assert.deepEqual(await financial(f),baseline);
      assert.equal((await reservationPriceWorkspace(f.scope,f.booking.publicReference!)).amendments.length,1);
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
      const regenerated=await preparePublicReservationLease(f.booking.publicReference!,"EFT");assert.ok(regenerated.ok);const newLease=await db.publicReservationLease.findUniqueOrThrow({where:{reservationId:f.booking.id}});assert.equal(newLease.status,"READY");assert.equal(newLease.paymentMethod,"EFT");assert.notEqual(newLease.sha256,oldLease.sha256);assert.equal(newLease.signedAt,null);
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
      await db.publicPaymentSession.deleteMany({where:{reservation:{customer:{organisationId}}}});await db.publicReservationLease.deleteMany({where:{reservation:{customer:{organisationId}}}});await db.reservation.deleteMany({where:{customer:{organisationId}}});await db.organisation.delete({where:{id:organisationId}});
    }
    if(oldKey===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=oldKey;if(oldUrl===undefined)delete process.env.APP_URL;else process.env.APP_URL=oldUrl;await db.$disconnect();
  }
});
