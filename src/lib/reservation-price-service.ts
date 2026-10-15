import {createHash, randomBytes, randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {db} from "./db";
import {facilityWhere,type RequestScope} from "./scope";
import {decryptIntegrationSecret,encryptIntegrationSecret} from "./integrations/integration-secret-vault";
import {identityAccessMatches} from "./identity-document-security";
import {publicInitialRent,publicCheckoutTotal} from "./public-initial-rent";
import {requireOperationalUnit} from "./floor-availability-service";
import {proposedReservationPrice,reservationPriceBlockers,requireIndependentPriceApproval,reservationPriceProposalSchema,reservationPriceDecisionSchema,reservationPriceAcceptanceSchema,type ReservationPriceProposal,type ReservationPriceDecision,type ReservationPriceAcceptance,reservationPriceNotice} from "./reservation-price-policy";

type Tx=Prisma.TransactionClient;
const include={customer:{select:{id:true,organisationId:true,emailVerifiedAt:true}},publicLease:{include:{mandate:{select:{id:true}}}},packageSelection:true,_count:{select:{publicPaymentSessions:true}}} satisfies Prisma.ReservationInclude;
type Booking=Prisma.ReservationGetPayload<{include:typeof include}>;
const canonical=(value:unknown):string=>JSON.stringify(value,(_,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const hash=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const read=(value:string)=>JSON.parse(decryptIntegrationSecret(value));
function originalIntact(item:{originalEncrypted:string;sourceFingerprint:string}){try{if(hash(read(item.originalEncrypted))!==item.sourceFingerprint)throw Error();}catch{throw Error("PRICE_ORIGINAL_REVIEW_REQUIRED");}}
function appliedIntact(booking:Booking,item:{acceptedCustomerId:string|null;originalEncrypted:string;sourceFingerprint:string;proposedEncrypted:string}){
  originalIntact(item);const proposed=read(item.proposedEncrypted);
  if(item.acceptedCustomerId!==booking.customerId||Number(booking.quotedRate)!==Number(proposed.monthlyRate)||canonical(booking.initialRentSnapshot)!==canonical(proposed.initialRentSnapshot))throw Error("PRICE_SOURCE_CHANGED");
  return proposed;
}
async function scopedBooking(tx:Tx,scope:RequestScope,id:string){
  const found=await tx.reservation.findFirst({where:{id,facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}},select:{id:true}});
  if(!found)throw Error("NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id"=${found.id} FOR UPDATE`;
  const booking=await tx.reservation.findFirst({where:{id,facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}},include});
  if(!booking)throw Error("NOT_FOUND");return booking;
}
async function source(tx:Tx,booking:Booking){
  const account=await tx.account.findUnique({where:{accountNumber:`ST24-T-${booking.id}`},select:{id:true,customerId:true,currency:true,balance:true,tenancy:{select:{id:true}},_count:{select:{ledgerEntries:true,payments:true,debitInstructions:true,adjustments:true,merchandiseOrders:true}}}});
  const goods=Number(booking.packageSelection?.priceSnapshot??0);
  const financialActivity=Boolean(!Number.isFinite(goods)||goods<0||goods>10000000||Math.abs(goods*100-Math.round(goods*100))>0.000001||account&&(account.customerId!==booking.customerId||account.currency!=="ZAR"||!account.balance.isZero()||account.tenancy||Object.values(account._count).some(n=>n>0)));
  const blockers=reservationPriceBlockers({...booking,emailVerifiedAt:booking.customer.emailVerifiedAt,signed:Boolean(booking.publicLease&&(booking.publicLease.status==="SIGNED"||booking.publicLease.signedAt||booking.publicLease.signedPdf)),mandate:Boolean(booking.publicLease?.mandate),paymentSessions:booking._count.publicPaymentSessions,financialActivity});
  const org=await tx.organisation.findUniqueOrThrow({where:{id:booking.customer.organisationId},select:{currency:true}});
  if(org.currency!=="ZAR")blockers.push("This quote workflow supports ZAR only.");
  const original={version:1,reservationId:booking.id,organisationId:booking.customer.organisationId,facilityId:booking.facilityId,customerId:booking.customerId,unitId:booking.unitId,source:booking.source,status:booking.status,journey:booking.journey,productLine:booking.productLine,businessDetails:booking.businessDetails,rentalPlan:booking.rentalPlan,quotedRate:booking.quotedRate.toFixed(2),initialRentSnapshot:booking.initialRentSnapshot,intendedMoveIn:booking.intendedMoveIn?.toISOString()??null,holdExpiresAt:booking.holdExpiresAt?.toISOString()??null,convertedTenancyId:booking.convertedTenancyId,package:booking.packageSelection?{id:booking.packageSelection.id,price:booking.packageSelection.priceSnapshot.toFixed(2),items:booking.packageSelection.itemsSnapshot,name:booking.packageSelection.packageName,status:booking.packageSelection.status}:null,lease:booking.publicLease?{id:booking.publicLease.id,status:booking.publicLease.status,version:booking.publicLease.version,sha256:booking.publicLease.sha256,content:booking.publicLease.content,paymentMethod:booking.publicLease.paymentMethod,signedAt:booking.publicLease.signedAt?.toISOString()??null}:null,account:account?{id:account.id,customerId:account.customerId,currency:account.currency,balance:account.balance.toFixed(2),tenancyId:account.tenancy?.id??null,counts:account._count}:null,paymentSessions:booking._count.publicPaymentSessions};
  return {blockers,original,fingerprint:hash(original)};
}
async function audit(tx:Tx,org:string,store:string,actor:string|null,id:string,action:string,after:unknown){await tx.auditEvent.create({data:{organisationId:org,facilityId:store,actorId:actor,action:`reservation.price_${action}`,entityType:"ReservationPriceAmendment",entityId:id,after:json(after)}});}
function assertSource(proof:Awaited<ReturnType<typeof source>>,fingerprint?:string){if(proof.blockers.length)throw Error("PRICE_REVIEW_REQUIRED");if(fingerprint&&proof.fingerprint!==fingerprint)throw Error("PRICE_SOURCE_CHANGED");}

export async function proposeReservationPrice(scope:RequestScope,input:ReservationPriceProposal){
  const data=reservationPriceProposalSchema.parse(input),requestHash=hash(data);
  return db.$transaction(async tx=>{
    const booking=await scopedBooking(tx,scope,data.reservationId);if(booking.facilityId!==data.facilityId)throw Error("FORBIDDEN");
    const existing=await tx.reservationPriceAmendment.findUnique({where:{organisationId_requestKey:{organisationId:scope.organisationId,requestKey:data.requestKey}}});
    if(existing){if(existing.requestHash!==requestHash)throw Error("CONFLICT");return {id:existing.id,idempotent:true};}
    const proof=await source(tx,booking);assertSource(proof);
    if(Number(data.monthlyRate)===Number(booking.quotedRate))throw Error("PRICE_UNCHANGED");
    if(await tx.reservationPriceAmendment.count({where:{organisationId:scope.organisationId,reservationId:booking.id,status:{in:["PROPOSED","APPROVED"]}}}))throw Error("PRICE_PENDING_EXISTS");
    const expiresAt=new Date(Math.min(Date.now()+24*60*60*1000,booking.holdExpiresAt!.getTime()));
    const proposed={version:1,monthlyRate:Number(data.monthlyRate).toFixed(2),initialRentSnapshot:proposedReservationPrice(data.monthlyRate,booking.intendedMoveIn!),reason:data.reason};
    publicCheckoutTotal({...booking,quotedRate:proposed.monthlyRate,initialRentSnapshot:proposed.initialRentSnapshot});
    const id=randomUUID(),quoteFingerprint=hash({reservationId:booking.id,sourceFingerprint:proof.fingerprint,proposed,expiresAt:expiresAt.toISOString()});
    await tx.reservationPriceAmendment.create({data:{id,organisationId:scope.organisationId,facilityId:booking.facilityId,reservationId:booking.id,sourceFingerprint:proof.fingerprint,quoteFingerprint,originalEncrypted:encryptIntegrationSecret(canonical(proof.original)),proposedEncrypted:encryptIntegrationSecret(canonical(proposed)),requestKey:data.requestKey,requestHash,proposedById:scope.userId,expiresAt}});
    await audit(tx,scope.organisationId,booking.facilityId,scope.userId,id,"proposed",{reservationId:booking.id,sourceFingerprint:proof.fingerprint,quoteFingerprint,expiresAt:expiresAt.toISOString(),financialPosting:false});
    return {id,idempotent:false};
  });
}
export async function decideReservationPrice(scope:RequestScope,input:ReservationPriceDecision){
  const data=reservationPriceDecisionSchema.parse(input);
  return db.$transaction(async tx=>{
    const target=await tx.reservationPriceAmendment.findFirst({where:{id:data.id,organisationId:scope.organisationId,facilityId:data.facilityId}});if(!target)throw Error("NOT_FOUND");
    const booking=await scopedBooking(tx,scope,target.reservationId);
    const item=await tx.reservationPriceAmendment.findUniqueOrThrow({where:{id:target.id}});
    if(item.revision!==data.revision||!["PROPOSED","APPROVED"].includes(item.status))throw Error("CONFLICT");
    if(data.decision!=="WITHDRAWN")requireIndependentPriceApproval(item.proposedById,scope.userId);
    if(data.decision==="APPROVED"){
      originalIntact(item);
      if(item.status!=="PROPOSED"||item.expiresAt<=new Date())throw Error("PRICE_EXPIRED");
      assertSource(await source(tx,booking),item.sourceFingerprint);
    }
    const changed=await tx.reservationPriceAmendment.updateMany({where:{id:item.id,revision:data.revision,status:item.status},data:{status:data.decision,revision:{increment:1},reviewedById:scope.userId,reviewedAt:new Date(),reviewReference:data.reference}});if(changed.count!==1)throw Error("CONFLICT");
    await audit(tx,scope.organisationId,item.facilityId,scope.userId,item.id,data.decision.toLowerCase(),{reservationId:item.reservationId,revision:data.revision+1,quoteFingerprint:item.quoteFingerprint,reference:data.reference,financialPosting:false});return {id:item.id};
  });
}

async function customerBooking(tx:Tx,reference:string,token:string,id:string,lock=false){
  const target=await tx.reservation.findUnique({where:{publicReference:reference},select:{id:true,unitId:true,facilityId:true}});if(!target)throw Error("NOT_FOUND");
  if(lock){await requireOperationalUnit(tx,target.facilityId,target.unitId);await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id"=${target.id} FOR UPDATE`;}
  const booking=await tx.reservation.findUniqueOrThrow({where:{id:target.id},include});
  if(lock)await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id"=${booking.customerId} FOR UPDATE`;
  const customer=await tx.customer.findUniqueOrThrow({where:{id:booking.customerId},select:{emailVerifiedAt:true}});
  const item=await tx.reservationPriceAmendment.findFirst({where:{id,reservationId:booking.id,organisationId:booking.customer.organisationId,facilityId:booking.facilityId}});
  if(!item||!identityAccessMatches(token,booking.identityAccessHash,booking.identityAccessExpiresAt)||!item.reviewedAt||!customer.emailVerifiedAt||customer.emailVerifiedAt<=item.reviewedAt||customer.emailVerifiedAt>new Date())throw Error("PRICE_FRESH_VERIFICATION_REQUIRED");
  const verification=await tx.auditEvent.findFirst({where:{organisationId:booking.customer.organisationId,facilityId:booking.facilityId,entityType:"Reservation",entityId:booking.id,action:"public_reservation.email_verified",occurredAt:{gt:item.reviewedAt}},orderBy:{occurredAt:"desc"},select:{after:true}});
  if((verification?.after as {verifiedAt?:string}|null)?.verifiedAt!==customer.emailVerifiedAt.toISOString())throw Error("PRICE_FRESH_VERIFICATION_REQUIRED");
  return {booking,item,customer};
}
export async function previewCustomerReservationPrice(reference:string,token:string,id:string){return db.$transaction(async tx=>{
  const {booking,item}=await customerBooking(tx,reference,token,id);
  if(item.status==="APPLIED"){
    const proposed=appliedIntact(booking,item),original=read(item.originalEncrypted),goods=Number(booking.packageSelection?.priceSnapshot??0);
    return {id:item.id,reference,quoteFingerprint:item.quoteFingerprint,previousMonthlyRate:original.quotedRate,monthlyRate:proposed.monthlyRate,previousInitialRent:Number(original.initialRentSnapshot.total).toFixed(2),initialRent:Number(proposed.initialRentSnapshot.total).toFixed(2),goods:goods.toFixed(2),previousCheckoutTotal:(Number(original.initialRentSnapshot.total)+goods).toFixed(2),checkoutTotal:publicCheckoutTotal(booking).toFixed(2),lines:proposed.initialRentSnapshot.lines,expiresAt:item.expiresAt.toISOString(),notice:reservationPriceNotice,applied:true};
  }
  if(item.status!=="APPROVED"||item.expiresAt<=new Date())throw Error("PRICE_EXPIRED");
  originalIntact(item);
  assertSource(await source(tx,booking),item.sourceFingerprint);
  const proposed=read(item.proposedEncrypted),original=publicInitialRent(booking);
  const goods=Number(booking.packageSelection?.priceSnapshot??0);
  return {id:item.id,reference,quoteFingerprint:item.quoteFingerprint,previousMonthlyRate:booking.quotedRate.toFixed(2),monthlyRate:proposed.monthlyRate,previousInitialRent:original.total.toFixed(2),initialRent:Number(proposed.initialRentSnapshot.total).toFixed(2),goods:goods.toFixed(2),previousCheckoutTotal:publicCheckoutTotal(booking).toFixed(2),checkoutTotal:(Number(proposed.initialRentSnapshot.total)+goods).toFixed(2),lines:proposed.initialRentSnapshot.lines,expiresAt:item.expiresAt.toISOString(),notice:reservationPriceNotice,applied:false};
},{isolationLevel:"RepeatableRead"});}

export async function acceptCustomerReservationPrice(input:ReservationPriceAcceptance){
  const data=reservationPriceAcceptanceSchema.parse(input);
  return db.$transaction(async tx=>{
    const {booking,item,customer}=await customerBooking(tx,data.reference,data.identityAccessToken,data.id,true);
    if(item.status==="APPLIED"&&item.acceptedCustomerId===booking.customerId&&item.acceptanceFingerprint===data.quoteFingerprint)return {id:item.id,applied:true,idempotent:true};
    if(item.status!=="APPROVED"||item.expiresAt<=new Date())throw Error("PRICE_EXPIRED");
    if(item.quoteFingerprint!==data.quoteFingerprint)throw Error("PRICE_SOURCE_CHANGED");
    originalIntact(item);
    const proof=await source(tx,booking);assertSource(proof,item.sourceFingerprint);
    const proposed=read(item.proposedEncrypted);
    publicCheckoutTotal({...booking,quotedRate:proposed.monthlyRate,initialRentSnapshot:proposed.initialRentSnapshot});
    if(hash({reservationId:booking.id,sourceFingerprint:proof.fingerprint,proposed,expiresAt:item.expiresAt.toISOString()})!==item.quoteFingerprint)throw Error("PRICE_SOURCE_CHANGED");
    // Keep the original quote and unsigned document encrypted in the immutable
    // amendment; a previous signing link can no longer accept old particulars.
    if(booking.publicLease)await tx.publicReservationLease.update({where:{id:booking.publicLease.id},data:{status:"REQUOTE_REQUIRED",expiresAt:new Date(),signingToken:randomBytes(32).toString("base64url")}});
    await tx.reservation.update({where:{id:booking.id},data:{quotedRate:proposed.monthlyRate,initialRentSnapshot:json(proposed.initialRentSnapshot)}});
    const acceptedAt=new Date();
    if(item.expiresAt<=acceptedAt||!booking.holdExpiresAt||booking.holdExpiresAt<=acceptedAt)throw Error("PRICE_EXPIRED");
    const changed=await tx.reservationPriceAmendment.updateMany({where:{id:item.id,status:"APPROVED",revision:item.revision},data:{status:"APPLIED",revision:{increment:1},acceptedCustomerId:booking.customerId,acceptedAt,acceptanceFingerprint:item.quoteFingerprint}});if(changed.count!==1)throw Error("CONFLICT");
    await audit(tx,item.organisationId,item.facilityId,null,item.id,"customer_accepted",{reservationId:booking.id,customerId:booking.customerId,quoteFingerprint:item.quoteFingerprint,verifiedAt:customer.emailVerifiedAt!.toISOString(),acceptedAt:acceptedAt.toISOString(),newAgreementRequired:true,financialPosting:false});
    return {id:item.id,applied:true,idempotent:false};
  });
}

export async function reservationPriceVerificationAvailable(reference:string,id:string){
  return db.$transaction(async tx=>{
    const booking=await tx.reservation.findUnique({where:{publicReference:reference},include});if(!booking)throw Error("NOT_FOUND");
    const item=await tx.reservationPriceAmendment.findFirst({where:{id,reservationId:booking.id,organisationId:booking.customer.organisationId,facilityId:booking.facilityId,status:{in:["APPROVED","APPLIED"]}}});
    if(!item)throw Error("NOT_FOUND");
    if(item.status==="APPLIED")appliedIntact(booking,item);else{if(item.expiresAt<=new Date())throw Error("PRICE_EXPIRED");originalIntact(item);assertSource(await source(tx,booking),item.sourceFingerprint);}
    return true;
  },{isolationLevel:"RepeatableRead"});
}
export async function appliedCustomerReservationPrice(reference:string,token:string,id:string){return db.$transaction(async tx=>{
  const {booking,item}=await customerBooking(tx,reference,token,id);
  if(item.status!=="APPLIED"||item.acceptedCustomerId!==booking.customerId)throw Error("NOT_FOUND");
  appliedIntact(booking,item);
  return {reference};
});}

export async function reservationPriceWorkspace(scope:RequestScope,reference:string){return db.$transaction(async tx=>{
  const booking=await tx.reservation.findFirst({where:{OR:[{id:reference},{publicReference:reference}],facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}},include});
  if(!booking)throw Error("NOT_FOUND");const proof=await source(tx,booking);
  const records=await tx.reservationPriceAmendment.findMany({where:{organisationId:scope.organisationId,facilityId:booking.facilityId,reservationId:booking.id},take:51,orderBy:[{createdAt:"desc"},{id:"desc"}]});
  const amendments=records.slice(0,50).map(item=>{
    let original:ReturnType<typeof read>|null=null,proposed:ReturnType<typeof read>|null=null,issue:string|null=null;
    try{originalIntact(item);original=read(item.originalEncrypted);proposed=read(item.proposedEncrypted);}catch{issue="Retained quote evidence needs review.";}
    if(["PROPOSED","APPROVED"].includes(item.status)&&(proof.fingerprint!==item.sourceFingerprint||proof.blockers.length))issue="The original booking changed or needs review.";
    return {id:item.id,status:item.status,revision:item.revision,proposedById:item.proposedById,reviewedById:item.reviewedById,reviewReference:item.reviewReference,expiresAt:item.expiresAt,createdAt:item.createdAt,acceptedAt:item.acceptedAt,quoteFingerprint:item.quoteFingerprint,previousMonthlyRate:original?.quotedRate??null,monthlyRate:proposed?.monthlyRate??null,reason:proposed?.reason??null,issue};
  });
  return {userId:scope.userId,reservation:{id:booking.id,reference:booking.publicReference,facilityId:booking.facilityId,monthlyRate:booking.quotedRate.toFixed(2),intendedMoveIn:booking.intendedMoveIn,holdExpiresAt:booking.holdExpiresAt,status:booking.status},blockers:proof.blockers,amendments,historyTruncated:records.length>50,notice:reservationPriceNotice};
},{isolationLevel:"RepeatableRead"});}
