import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";

type Database = Prisma.TransactionClient;
const trialSchema=z.object({enabled:z.literal(true),version:z.string().min(1),notice:z.string().min(40),consentLabel:z.string().min(15),approvalReference:z.string().min(1),alternativeContact:z.string().min(1),retentionHours:z.literal(1),trialReservationId:z.string().min(1),trialEndsAt:z.iso.datetime({offset:true})});
function configuredPrimaryTrial(organisationId:string) {
  try {
    const parsed=trialSchema.safeParse(JSON.parse(process.env.UNIT58_PRIMARY_PHOTO_TRIAL_JSON??"{}")[organisationId]);
    return parsed.success&&Date.parse(parsed.data.trialEndsAt)>Date.now()?parsed.data:null;
  } catch { return null; }
}
export async function primaryTrialPolicy(database:Database,organisationId:string,tenancyId:string) {
  const policy=configuredPrimaryTrial(organisationId);
  if(!policy)return null;
  try {
    const reservation=await database.reservation.findFirst({where:{id:policy.trialReservationId,convertedTenancyId:tenancyId,status:"CONVERTED",facility:{organisationId}},include:{unit:true,convertedTenancy:{include:{account:true,occupancies:true,documents:{where:{type:"LEASE_AGREEMENT"}}}}}});
    const tenancy=reservation?.convertedTenancy;
    const signed=tenancy?.documents.filter(d=>d.provider==="BLENDSIGN"&&d.status==="SIGNED"&&d.signedAt&&d.externalId);
    if(!reservation||!tenancy||tenancy.status!=="DRAFT"||tenancy.customerId!==reservation.customerId||tenancy.facilityId!==reservation.facilityId||tenancy.account.customerId!==reservation.customerId||tenancy.occupancies.length!==1||tenancy.occupancies[0].unitId!==reservation.unitId||tenancy.occupancies[0].status!=="PENDING"||reservation.unit.status!=="RESERVED"||signed?.length!==1)return null;
    return {...policy,hash:createHash("sha256").update(JSON.stringify(policy)).digest("hex")};
  } catch { return null; }
}
export async function primaryTrialSnapshot(scope:RequestScope) {
  const policy=configuredPrimaryTrial(scope.organisationId);
  if(!policy)return null;
  const reservation=await db.reservation.findFirst({where:{id:policy.trialReservationId,facility:facilityWhere(scope)},select:{publicReference:true,convertedTenancyId:true,unit:{select:{number:true}},customer:{select:{firstName:true,lastName:true,companyName:true}},convertedTenancy:{select:{legacyAccessPhoto:{select:{status:true,expiresAt:true}}}}}});
  return reservation?.convertedTenancyId&&await primaryTrialPolicy(db,scope.organisationId,reservation.convertedTenancyId)?{reference:reservation.publicReference,unitNumber:reservation.unit.number,customerName:[reservation.customer.firstName??reservation.customer.companyName??"Customer",reservation.customer.lastName].filter(Boolean).join(" "),photoStatus:reservation.convertedTenancy?.legacyAccessPhoto?.expiresAt&&reservation.convertedTenancy.legacyAccessPhoto.expiresAt<=new Date()?"EXPIRED":reservation.convertedTenancy?.legacyAccessPhoto?.status??"NOT_SUBMITTED",expiresAt:reservation.convertedTenancy?.legacyAccessPhoto?.expiresAt?.toISOString()??null}:null;
}
