import {createHash,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {requireOperationalUnit} from "./floor-availability-service";
import {southAfricaDateKey} from "./south-africa-time";
import {confirmedPublicHoldExpiry} from "./public-booking-contract";

class RenewalUnavailable extends Error {}
const unavailable=()=>{throw new RenewalUnavailable();};
const sameKey=(a:string,b:string)=>timingSafeEqual(createHash("sha256").update(a).digest(),createHash("sha256").update(b).digest());

// Reclaim only this browser's expired public hold, under the allocation locks.
export async function preparePublicVerificationCode(input:{id:string;hash:string;channel:"MOBILE"|"EMAIL";bookingKey?:string;allowStaffEmail?:boolean}) {
 const found=await db.reservation.findUnique({where:{id:input.id},select:{unitId:true,facilityId:true,publicLease:{select:{status:true}}}});
 if(!found)return {ok:false as const,code:"RESERVATION_UNAVAILABLE"};
 try{return await db.$transaction(async tx=>{
  if(input.channel==="EMAIL"&&found.publicLease?.status==="SIGNED")await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id"=${found.unitId} FOR UPDATE`;
  else await requireOperationalUnit(tx,found.facilityId,found.unitId);
  await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id"=${input.id} FOR UPDATE`;
  const r=await tx.reservation.findUnique({where:{id:input.id},include:{customer:true,unit:true,lead:true,publicLease:true,packageSelection:true,_count:{select:{publicPaymentSessions:true}}}});
  if(!r||r.convertedTenancyId||input.channel==="MOBILE"&&r.contactVerifiedAt||input.channel==="EMAIL"&&!r.contactVerifiedAt&&!input.allowStaffEmail)return unavailable();
  const now=new Date(),expiresAt=new Date(now.getTime()+10*60_000);
  const signedEmail=input.channel==="EMAIL"&&r.status==="ACTIVE"&&r.publicLease?.status==="SIGNED";
  let holdExpiresAt=r.holdExpiresAt;
  const renew=!signedEmail&&(r.status!=="ACTIVE"||!holdExpiresAt||holdExpiresAt<=now);
  if(renew){
   if(!input.bookingKey||!r.idempotencyKey||!sameKey(input.bookingKey,r.idempotencyKey)||!["PUBLIC_WEBSITE","PUBLIC_VIEWING","PUBLIC_WALK_IN"].includes(r.source)||r.publicLease||r._count.publicPaymentSessions||!r.holdExpiresAt||r.holdExpiresAt>now||r.viewingAt&&r.viewingAt<=now||r.intendedMoveIn&&southAfricaDateKey(r.intendedMoveIn)<southAfricaDateKey(now))return unavailable();
   if(r.status!=="ACTIVE"){
    const last=await tx.auditEvent.findFirst({where:{entityType:"Reservation",entityId:r.id},orderBy:{occurredAt:"desc"},select:{action:true}});
    if(r.status!=="CANCELLED"||last?.action!=="public_reservation.hold_expired")return unavailable();
   }
   if(r.unit.status!=="AVAILABLE"&&!(r.status==="ACTIVE"&&r.unit.status==="RESERVED")||!r.unit.monthlyRate.equals(r.quotedRate))return unavailable();
   if(await tx.reservation.count({where:{unitId:r.unitId,status:"ACTIVE",id:{not:r.id}}})||await tx.occupancy.count({where:{unitId:r.unitId,status:{in:["PENDING","ACTIVE","NOTICE_GIVEN","TRANSFERRING"]}}})||await tx.maintenanceRequest.count({where:{unitId:r.unitId,status:{in:["OPEN","SCHEDULED","IN_PROGRESS","BLOCKED"]}}}))return unavailable();
   if(r.lead&&!["QUOTED","CONTACTED","RESERVED","VIEWING_BOOKED"].includes(r.lead.stage))return unavailable();
   if(r.packageSelection&&r.packageSelection.status!=="RESERVED"){
    if(r.packageSelection.status!=="RELEASED")return unavailable();
    const lines=z.array(z.object({productId:z.string().min(1),quantity:z.number().int().positive(),unitPriceZar:z.number().nonnegative()})).safeParse(r.packageSelection.itemsSnapshot);
    if(!lines.success)return unavailable();
    if(r.packageSelection.storagePackageId){const current=await tx.storagePackage.findFirst({where:{id:r.packageSelection.storagePackageId,facilityId:r.facilityId,active:true},select:{sellingPrice:true}});if(!current||!current.sellingPrice.equals(r.packageSelection.priceSnapshot))return unavailable();}
    for(const line of lines.data.sort((a,b)=>a.productId.localeCompare(b.productId))){
     const claimed=await tx.$queryRaw<{id:string}[]>`UPDATE "Product" SET "quantityReserved"="quantityReserved"+${line.quantity},"updatedAt"=NOW() WHERE id=${line.productId} AND "facilityId"=${r.facilityId} AND active=true AND "sellingPrice"=${line.unitPriceZar} AND "quantityOnHand"-"quantityReserved">=${line.quantity} RETURNING id`;
     if(claimed.length!==1)return unavailable();
    }
    await tx.reservationPackage.update({where:{id:r.packageSelection.id},data:{status:"RESERVED",releasedAt:null}});
   }
   holdExpiresAt=input.channel==="MOBILE"?expiresAt:confirmedPublicHoldExpiry(now,r.journey,r.viewingAt);
   await tx.unit.update({where:{id:r.unitId},data:{status:"RESERVED"}});
   if(r.leadId)await tx.lead.update({where:{id:r.leadId},data:{stage:r.journey==="VIEWING"?"VIEWING_BOOKED":"RESERVED"}});
   await tx.auditEvent.create({data:{organisationId:r.customer.organisationId,facilityId:r.facilityId,entityType:"Reservation",entityId:r.id,action:"public_reservation.verification_hold_renewed",after:{channel:input.channel,holdExpiresAt:holdExpiresAt.toISOString()}}});
  }else if(r.status!=="ACTIVE")return unavailable();
  await tx.reservation.update({where:{id:r.id},data:{status:"ACTIVE",verificationCodeHash:input.hash,verificationExpiresAt:expiresAt,verificationAttempts:0,holdExpiresAt:input.channel==="MOBILE"?expiresAt:holdExpiresAt}});
  return {ok:true as const,verificationExpiresAt:expiresAt,holdExpiresAt:input.channel==="MOBILE"?expiresAt:holdExpiresAt};
 });}catch(error){if(error instanceof RenewalUnavailable||error instanceof Error&&["UNIT_UNAVAILABLE","FLOOR_NOT_OPERATIONAL"].includes(error.message))return {ok:false as const,code:"RESERVATION_UNAVAILABLE"};throw error;}
}
