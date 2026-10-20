import {randomInt,randomUUID,createHash} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {db} from "./db";
import type {RequestScope} from "./scope";
import {requireFacility} from "./scope";
import {currentRoleAccess} from "./current-role-access";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "./integrations/integration-secret-vault";
import {TwilioWhatsAppProvider} from "./integrations/twilio-provider";
import {rateLimit} from "./request-security";
import {reservationPriceApprovalTarget,decideReservationPriceInTransaction} from "./reservation-price-service";
import {canApprovePrice,priceApprovalCodeHash,matchesPriceApprovalCode,requireUsablePriceChallenge,priceManagerRequestSchema,priceManagerVerifySchema,priceManagerContactSchema} from "./price-manager-policy";
const domain="STAFF_PRICE_APPROVAL_WHATSAPP";
const assignments={roleAssignments:{include:{role:true}}} as const;
function contactWhere(organisationId:string,userId:string){return {organisationId,facilityId:null,domain,name:userId};}
async function contact(client:Prisma.TransactionClient,organisationId:string,userId:string){return client.configurationProfile.findFirst({where:contactWhere(organisationId,userId)});}
function readContact(row:Awaited<ReturnType<typeof contact>>){if(!row||row.status!=="ACTIVE")throw Error("PRICE_OTP_CONTACT_REQUIRED");const parsed=priceManagerContactSchema.parse(JSON.parse(decryptIntegrationSecret((row.config as {encrypted:string}).encrypted)));if(!parsed.phone)throw Error("PRICE_OTP_CONTACT_REQUIRED");return parsed.phone;}
const version=(row:{id:string;updatedAt:Date;config:unknown})=>createHash("sha256").update(row.id+row.updatedAt.toISOString()+JSON.stringify(row.config)).digest("hex");
export async function staffPriceContact(organisationId:string,userId:string){
 const user=await db.user.findFirst({where:{id:userId,organisationId}});if(!user)throw Error("NOT_FOUND");const row=await contact(db,organisationId,userId);if(!row||row.status!=="ACTIVE")return {configured:false,maskedPhone:null};const phone=readContact(row);return {configured:true,maskedPhone:`Ending ${phone.slice(-4)}`};
}
export async function saveStaffPriceContact(organisationId:string,actorId:string,userId:string,input:unknown){const data=priceManagerContactSchema.parse(input);
 return db.$transaction(async tx=>{
  // Serialise first registration too: nullable configuration keys are not unique in PostgreSQL.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} AND "organisationId"=${organisationId} FOR UPDATE`;
  const user=await tx.user.findFirst({where:{id:userId,organisationId,active:true}});if(!user)throw Error("NOT_FOUND");
  const previous=await contact(tx,organisationId,userId),config={encrypted:encryptIntegrationSecret(JSON.stringify(data))},status=data.phone?"ACTIVE":"DISABLED";
  if(previous)await tx.configurationProfile.update({where:{id:previous.id},data:{config,status}});else await tx.configurationProfile.create({data:{...contactWhere(organisationId,userId),config,status}});
  await tx.priceApprovalChallenge.updateMany({where:{organisationId,approverId:userId,status:{in:["SENDING","SENT"]}},data:{status:"CANCELLED"}});
  await tx.auditEvent.create({data:{organisationId,actorId,entityType:"User",entityId:userId,action:"staff.price_approval_contact_updated",after:{configured:!!data.phone,whatsappAuthorisationConsent:true,financialPosting:false}}});return {configured:!!data.phone,maskedPhone:data.phone?`Ending ${data.phone.slice(-4)}`:null};
 });
}
export async function priceManagerOptions(scope:RequestScope,facilityId:string){await requireFacility(scope,facilityId);const users=await db.user.findMany({where:{organisationId:scope.organisationId,active:true},include:assignments,orderBy:{name:"asc"},take:500});const contacts=await db.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId:null,domain,status:"ACTIVE"},select:{name:true}});const registered=new Set(contacts.map(row=>row.name));return {configured:!!process.env.TWILIO_WHATSAPP_PRICE_APPROVAL_SID&&!!process.env.TWILIO_ACCOUNT_SID&&!!process.env.TWILIO_AUTH_TOKEN&&!!process.env.TWILIO_WHATSAPP_FROM,approvers:users.filter(user=>registered.has(user.id)&&canApprovePrice(user.roleAssignments,facilityId)).map(user=>({id:user.id,name:user.name}))};}
async function usersForApproval(tx:Prisma.TransactionClient,scope:RequestScope,approverId:string,facilityId:string){await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${scope.userId},${approverId}) AND "organisationId"=${scope.organisationId} ORDER BY "id" FOR SHARE`;const requester=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:assignments}),approver=await tx.user.findFirst({where:{id:approverId,organisationId:scope.organisationId,active:true},include:assignments});if(!requester||!approver||!canApprovePrice(approver.roleAssignments,facilityId)||!["reservation_prices.view","reservation_prices.propose","reservations.manage","billing.view"].every(permission=>currentRoleAccess(requester.roleAssignments,permission,facilityId).allowed))throw Error("FORBIDDEN");return {requester,approver};}
export async function requestManagerPriceApproval(scope:RequestScope,input:unknown,sessionHash:string){const data=priceManagerRequestSchema.parse(input);await requireFacility(scope,data.facilityId);const template=process.env.TWILIO_WHATSAPP_PRICE_APPROVAL_SID;if(!template||!/^HX[a-f0-9]{32}$/i.test(template)||!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN||!process.env.TWILIO_WHATSAPP_FROM)throw Error("PRICE_OTP_CONFIG_REQUIRED");
 for(const [key,limit,window]of [[`sender:${scope.userId}`,1,60000],[`hour:${scope.userId}`,5,3600000],[`manager:${data.approverId}`,10,3600000]] as const)if(await rateLimit(`price-otp:${scope.organisationId}:${key}`,limit,window))throw Error("PRICE_OTP_LIMIT");
 const id=randomUUID(),code=String(randomInt(100000,1000000));
 const prepared=await db.$transaction(async tx=>{
  const {requester,approver}=await usersForApproval(tx,scope,data.approverId,data.facilityId),row=await contact(tx,scope.organisationId,approver.id),phone=readContact(row);
  const {booking,item:proposal}=await reservationPriceApprovalTarget(tx,scope,data.id,data.facilityId,data.revision);
  await tx.priceApprovalChallenge.updateMany({where:{organisationId:scope.organisationId,requestedById:scope.userId,amendmentId:data.id,status:{in:["SENDING","SENT"]}},data:{status:"CANCELLED"}});
  const expiresAt=new Date(Math.min(Date.now()+300000,proposal.expiresAt.getTime()));
  await tx.priceApprovalChallenge.create({data:{id,organisationId:scope.organisationId,facilityId:data.facilityId,amendmentId:proposal.id,revision:proposal.revision,quoteFingerprint:proposal.quoteFingerprint,requestedById:scope.userId,approverId:approver.id,requesterSessionVersion:requester.sessionVersion,requesterSessionHash:sessionHash,approverSessionVersion:approver.sessionVersion,contactVersion:version(row!),codeHash:priceApprovalCodeHash(id,code),reference:data.reference,expiresAt}});
  const original=JSON.parse(decryptIntegrationSecret(proposal.originalEncrypted)),proposed=JSON.parse(decryptIntegrationSecret(proposal.proposedEncrypted));
  return {phone,expiresAt,variables:{"1":code,"2":booking.publicReference??proposal.reservationId,"3":String(original.quotedRate),"4":String(proposed.monthlyRate),"5":requester.name,"6":String(proposed.reason)}};
 });
 // Durable claim is made before sending. Never retry an uncertain external attempt.
 const result=await new TwilioWhatsAppProvider().sendTemplate(prepared.phone,template,prepared.variables,{organisationId:scope.organisationId,facilityId:data.facilityId,idempotencyKey:id});
 await db.priceApprovalChallenge.updateMany({where:{id,status:"SENDING"},data:{status:result.ok&&result.providerReference?"SENT":"REVIEW_REQUIRED",providerRef:result.ok?result.providerReference:null}});
 if(!result.ok||!result.providerReference)throw Error("PRICE_OTP_DELIVERY_REVIEW");return {challengeId:id,expiresAt:prepared.expiresAt};
}
export async function verifyManagerPriceApproval(scope:RequestScope,input:unknown,sessionHash:string){const data=priceManagerVerifySchema.parse(input);await requireFacility(scope,data.facilityId);if(await rateLimit(`price-otp-check:${scope.organisationId}:${scope.userId}`,20,300000))throw Error("PRICE_OTP_LIMIT");
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "PriceApprovalChallenge" WHERE "id"=${data.challengeId} AND "organisationId"=${scope.organisationId} AND "facilityId"=${data.facilityId} AND "requestedById"=${scope.userId} FOR UPDATE`;
  const challenge=await tx.priceApprovalChallenge.findFirst({where:{id:data.challengeId,organisationId:scope.organisationId,facilityId:data.facilityId,requestedById:scope.userId}});if(!challenge)throw Error("PRICE_OTP_INVALID");requireUsablePriceChallenge(challenge);
  const {requester,approver}=await usersForApproval(tx,scope,challenge.approverId,data.facilityId),registered=await contact(tx,scope.organisationId,approver.id);readContact(registered);
  if(sessionHash!==challenge.requesterSessionHash||requester.sessionVersion!==challenge.requesterSessionVersion||approver.sessionVersion!==challenge.approverSessionVersion||version(registered!)!==challenge.contactVersion)throw Error("PRICE_OTP_INVALID");
  if(!matchesPriceApprovalCode(challenge.id,data.code,challenge.codeHash)){await tx.priceApprovalChallenge.update({where:{id:challenge.id},data:{attempts:{increment:1}}});return null;}
  const proposal=await tx.reservationPriceAmendment.findFirst({where:{id:challenge.amendmentId,organisationId:scope.organisationId,facilityId:data.facilityId,revision:challenge.revision,quoteFingerprint:challenge.quoteFingerprint,status:"PROPOSED"}});if(!proposal)throw Error("PRICE_SOURCE_CHANGED");
  const decision=await decideReservationPriceInTransaction(tx,{...scope,userId:approver.id,facilityIds:[data.facilityId],unrestrictedFacilities:false},{id:proposal.id,facilityId:data.facilityId,revision:challenge.revision,decision:"APPROVED",reference:challenge.reference,confirmed:true},{requestedById:scope.userId,challengeId:challenge.id});
  requireUsablePriceChallenge(challenge);
  await tx.priceApprovalChallenge.update({where:{id:challenge.id},data:{status:"CONSUMED",consumedAt:new Date()}});return decision;
 });if(!result)throw Error("PRICE_OTP_INVALID");return result;
}
