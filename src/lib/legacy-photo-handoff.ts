import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { currentRoleAccess } from "@/lib/current-role-access";
import { assistedLegacyPhotoDetails, submitAssistedLegacyPhoto } from "@/lib/legacy-access-photo";
import type { RequestScope } from "@/lib/scope";

const hash = (token:string) => createHash("sha256").update(token).digest("hex");

export async function issueLegacyPhotoHandoff(scope:RequestScope,tenancyId:string,version:number) {
  const details=await assistedLegacyPhotoDetails(scope,tenancyId);
  if(details.version!==version)throw Error("PHOTO_CHANGED");
  const tenancy=await db.tenancy.findUniqueOrThrow({where:{id:tenancyId},select:{facilityId:true}});
  const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+5*60_000);
  await db.$transaction(async tx=>{
    await tx.legacyPhotoHandoff.deleteMany({where:{tenancyId,usedAt:null}});
    await tx.legacyPhotoHandoff.create({data:{tokenHash:hash(token),tenancyId,photoVersion:version,issuedById:scope.userId,organisationId:scope.organisationId,facilityId:tenancy.facilityId,expiresAt}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:tenancy.facilityId,actorId:scope.userId,action:"legacy_photo.handoff_issued",entityType:"Tenancy",entityId:tenancyId,after:{version,expiresAt:expiresAt.toISOString(),identityCheckedInPerson:true}}});
  });
  return {token,expiresAt};
}

async function active(token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("PHOTO_CHANGED");
  const handoff=await db.legacyPhotoHandoff.findUnique({where:{tokenHash:hash(token)}});
  if(!handoff||handoff.usedAt||handoff.expiresAt<=new Date())throw Error("PHOTO_CHANGED");
  const issuer=await db.user.findFirst({where:{id:handoff.issuedById,organisationId:handoff.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
  const access=currentRoleAccess(issuer?.roleAssignments.filter(a=>a.role.organisationId===handoff.organisationId)??[],"move_in.create",handoff.facilityId);
  if(!issuer||!access.allowed)throw Error("FORBIDDEN");
  const scope:RequestScope={userId:issuer.id,organisationId:handoff.organisationId,facilityIds:access.allowedFacilityIds??[],unrestrictedFacilities:access.allowedFacilityIds===null};
  const details=await assistedLegacyPhotoDetails(scope,handoff.tenancyId);
  if(details.version!==handoff.photoVersion)throw Error("PHOTO_CHANGED");
  return {handoff,scope,details};
}

export async function legacyPhotoHandoff(token:string) {
  const {handoff,details}=await active(token);
  return {name:details.name,unitNumber:details.unitNumber,notice:details.policy.notice,consentLabel:details.policy.consentLabel,alternativeContact:details.policy.alternativeContact,retentionHours:details.policy.retentionHours,policyHash:details.policy.hash,expiresAt:handoff.expiresAt.toISOString()};
}

export async function captureLegacyPhotoHandoff(token:string,input:{policyHash:string;consent:boolean;image:File}) {
  const {handoff,scope,details}=await active(token);
  if(!input.consent||input.policyHash!==details.policy.hash)throw Error("PHOTO_CONSENT_REQUIRED");
  await submitAssistedLegacyPhoto(scope,{tenancyId:handoff.tenancyId,expectedVersion:handoff.photoVersion,policyHash:input.policyHash,customerConsent:true,identityChecked:true,image:input.image,handoffId:handoff.id});
}
