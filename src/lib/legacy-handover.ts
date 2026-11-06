import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { requireOperationalUnit } from "@/lib/floor-availability-service";
import { legacyPaymentEvidence } from "@/lib/legacy-payment-evidence";
import { approvedPhotoForHandover } from "@/lib/facial-photo-activation";
import { identityGate } from "@/lib/identity-document-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { fetchBlendSignArtifact } from "@/lib/blendsign-client";
import { floorMapSelection, unitIsOperational } from "@/lib/floor-availability";
import type { Prisma } from "@/generated/prisma/client";

type Database=Prisma.TransactionClient;
async function scoped(database:Database,scope:RequestScope,id:string) {
  const tenancy=await database.tenancy.findFirst({where:{id,facility:facilityWhere(scope),customer:{organisationId:scope.organisationId},account:{customer:{organisationId:scope.organisationId}}},include:{facility:true,account:true,documents:{where:{type:"LEASE_AGREEMENT"}},reservation:true,legacyAccessPhoto:true,occupancies:{where:{status:{in:["PENDING","ACTIVE","NOTICE_GIVEN","TRANSFERRING"]}},include:{unit:{include:{mapElements:floorMapSelection}}}}}});
  if(!tenancy)throw Error("NOT_FOUND");return tenancy;
}
async function checks(database:Database,scope:RequestScope,id:string) {
  const tenancy=await scoped(database,scope,id);
  const handover=await database.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:tenancy.facilityId,entityType:"Tenancy",entityId:id,action:"tenancy.key_handover_confirmed"}});
  const blockers:string[]=[];
  if(tenancy.account.customerId!==tenancy.customerId)blockers.push("The account owner needs reconciliation.");
  const docs=tenancy.documents.filter(d=>d.status==="SIGNED"&&d.signedAt&&d.provider==="BLENDSIGN"&&d.externalId);
  if(docs.length!==1)blockers.push("The original signed agreement needs review.");
  const payment=await legacyPaymentEvidence(database,tenancy.accountId);
  if(!payment.ready)blockers.push("The saved initial charge and verified payment need reconciliation.");
  if(southAfricaDateKey(tenancy.startDate)>southAfricaDateKey(new Date()))blockers.push("The agreed move-in date has not arrived.");
  if(!["DRAFT","ACTIVE","NOTICE_GIVEN"].includes(tenancy.status)||tenancy.occupancies.length!==1)blockers.push("The lease and unit allocation need review.");
  const occupancy=tenancy.occupancies[0];
  if(occupancy && (occupancy.unit.facilityId!==tenancy.facilityId||!["RESERVED","OCCUPIED"].includes(occupancy.unit.status)||occupancy.accessState!=="PENDING"))blockers.push("The unit allocation or existing access state needs review.");
  if(occupancy && (occupancy.unit.combinedIntoUnitId || !unitIsOperational(occupancy.unit,tenancy.facility.closedFloors)))blockers.push("The selected unit is not operational.");
  if(tenancy.reservation && (tenancy.reservation.customerId!==tenancy.customerId || tenancy.reservation.facilityId!==tenancy.facilityId || tenancy.reservation.convertedTenancyId!==tenancy.id || tenancy.reservation.unitId!==occupancy?.unitId || tenancy.reservation.status!=="CONVERTED"))blockers.push("The original booking link needs review.");
  if(tenancy.reservation && !(await identityGate(database,scope.organisationId,tenancy.reservation.id,tenancy.reservation.createdAt,"HANDOVER")))blockers.push("The identity document needs staff acceptance.");
  if(!(await approvedPhotoForHandover(tenancy.legacyAccessPhoto,scope.organisationId,database)))blockers.push("A current staff-approved access photo is required.");
  return {tenancy,handover,payment,document:docs.length===1?docs[0]:null,blockers,ready:!handover&&!blockers.length};
}
export async function legacyHandoverReadiness(scope:RequestScope,id:string) {
  const state=await checks(db,scope,id);
  return {ready:state.ready,handedOver:Boolean(state.handover),blockers:state.blockers,payment:state.payment,documentId:state.document?.id??null,photo:state.tenancy.legacyAccessPhoto?{id:state.tenancy.legacyAccessPhoto.id,version:state.tenancy.legacyAccessPhoto.version,status:state.tenancy.legacyAccessPhoto.status}:null};
}
export async function legacySignedArtifactHash(envelopeId:string) {
  const response=await fetchBlendSignArtifact(envelopeId,"signed");
  if(!response.ok || !response.body)throw Error("MOVE_IN_DOCUMENT_REVIEW");
  const reader=response.body.getReader(), chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20*1024*1024){await reader.cancel();throw Error("MOVE_IN_DOCUMENT_REVIEW");}chunks.push(part.value);}const pdf=Buffer.concat(chunks);try {if(pdf.subarray(0,5).toString()!=="%PDF-")throw Error("MOVE_IN_DOCUMENT_REVIEW");return createHash("sha256").update(pdf).digest("hex");} finally {pdf.fill(0);}}
  finally {chunks.forEach(c=>c.fill(0));}
}
/** Caller verifies move_in.create and physically checks the customer and keys. */
export async function confirmLegacyHandover(scope:RequestScope,id:string,identityAndKeysConfirmed:boolean) {
  if(!identityAndKeysConfirmed)throw Error("MOVE_IN_NOT_READY");
  const initial=await checks(db,scope,id);if(initial.handover)return {tenancyId:id,idempotent:true};
  if(!initial.ready||!initial.document?.externalId||initial.tenancy.occupancies.length!==1)throw Error("MOVE_IN_NOT_READY");
  const artifactHash=await legacySignedArtifactHash(initial.document.externalId);
  return db.$transaction(async tx=>{
    await requireOperationalUnit(tx,initial.tenancy.facilityId,initial.tenancy.occupancies[0].unitId);
    await tx.$queryRaw`SELECT "id" FROM "Tenancy" WHERE "id" = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${initial.tenancy.accountId} FOR UPDATE`;
    const state=await checks(tx,scope,id);if(state.handover)return {tenancyId:id,idempotent:true};
    if(!state.ready||state.document?.id!==initial.document!.id||state.document.externalId!==initial.document!.externalId||state.tenancy.occupancies[0]?.id!==initial.tenancy.occupancies[0].id)throw Error("MOVE_IN_NOT_READY");
    const occupancy=state.tenancy.occupancies[0];
    const competing=await tx.occupancy.count({where:{unitId:occupancy.unitId,id:{not:occupancy.id},status:{in:["PENDING","ACTIVE","NOTICE_GIVEN","TRANSFERRING"]}}});
    const holds=await tx.reservation.count({where:{unitId:occupancy.unitId,status:"ACTIVE",id:{not:state.tenancy.reservation?.id??""}}});
    if(competing||holds||occupancy.status==="TRANSFERRING")throw Error("MOVE_IN_REVIEW_REQUIRED");
    await tx.occupancy.update({where:{id:occupancy.id},data:{status:"ACTIVE"}});
    await tx.unit.update({where:{id:occupancy.unitId},data:{status:"OCCUPIED"}});
    await tx.tenancy.update({where:{id},data:{status:"ACTIVE"}});
    await tx.legacyAccessPhoto.update({where:{tenancyId:id},data:{status:"PENDING_PROVIDER",activationRequestedAt:new Date()}});
    const reservation=state.tenancy.reservation;
    if(reservation?.leadId) {await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${reservation.leadId} FOR UPDATE`;const lead=await tx.lead.findFirst({where:{id:reservation.leadId,facilityId:state.tenancy.facilityId,customerId:state.tenancy.customerId}});if(!lead)throw Error("MOVE_IN_REVIEW_REQUIRED");if(lead.stage!=="WON"){await tx.lead.update({where:{id:lead.id},data:{stage:"WON"}});await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:state.tenancy.facilityId,actorId:scope.userId,action:"lead.stage_changed",entityType:"Lead",entityId:lead.id,before:{stage:lead.stage},after:{stage:"WON",reservationId:reservation.id,tenancyId:id}}});}}
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:state.tenancy.facilityId,actorId:scope.userId,action:"tenancy.key_handover_confirmed",entityType:"Tenancy",entityId:id,after:{reservationId:reservation?.id??null,accountId:state.tenancy.accountId,documentId:state.document!.id,signedArtifactSha256:artifactHash,paymentIds:state.payment.paymentIds,requiredAmount:state.payment.requiredAmount,paidAmount:state.payment.paidAmount,photoId:state.tenancy.legacyAccessPhoto!.id,photoVersion:state.tenancy.legacyAccessPhoto!.version,identityCheckedInPerson:true,accessState:"PENDING"}}});
    return {tenancyId:id,idempotent:false};
  });
}
