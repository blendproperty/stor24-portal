import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { facialPhotoPolicy } from "@/lib/facial-photo-security";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";

type Database = Prisma.TransactionClient;
export const interimPhotoPolicy = {
  version: "interim-20260923-v1", reviewStatus: "INTERIM_AWAITING_REVIEW",
  notice: "Interim STOR24 photo notice — awaiting review. STOR24 uses your photograph to prepare and review your facial-recognition enrolment for precinct entry through Hikvision/HikCentral. Authorised staff review your photograph and check your identity before handover. Uploading a photo does not activate gate access; staff must separately confirm activation. Your portal photograph is retained while your booking and tenancy remain active, and removed when the booking is cancelled or expires, the tenancy ends, or you withdraw consent. Provider/device biometric deletion must be arranged separately and confirmed by staff; this portal does not yet perform it. Facial enrolment is required for precinct entry under the current facility process. If you cannot provide a photograph, contact your facility manager before arriving; no alternative entry method is currently configured.",
  consentLabel: "I have read this interim notice and consent to my photograph being used for facial-access enrolment and staff review.",
  approvalReference: "Owner authorised interim settings; legal approval pending",
  retentionHours: null,
  alternativeContact: "Contact your STOR24 facility manager through your booking for photo or access assistance. An alternative entry method is not currently configured.",
};
export async function resolvedPhotoPolicy(database: Database, organisationId: string) {
  const control = await database.facialPhotoControl.findUnique({where:{organisationId}});
  if (!control) return facialPhotoPolicy(organisationId);
  if (control.policyVersion !== interimPhotoPolicy.version) return null;
  // Collection state is deliberately excluded from the consent hash. Pausing uploads
  // does not invalidate existing consent or prevent staff reviewing retained photos.
  return {...interimPhotoPolicy, enabled:control.enabled, hash:createHash("sha256").update(JSON.stringify(interimPhotoPolicy)).digest("hex")};
}
async function owner(database: Database, userId: string) {
  const user = await database.user.findUnique({where:{id:userId},include:{roleAssignments:{include:{role:true}}}});
  if (!user?.active || !user.roleAssignments.some(a=>!a.facilityId && a.role.organisationId===user.organisationId && a.role.name==="Organisation owner")) throw new Error("FORBIDDEN");
  return user;
}
export async function photoControlSnapshot(organisationId: string, userId: string) {
  const control = await db.facialPhotoControl.findUnique({where:{organisationId}});
  // Existing owner pin (already established for this organisation) prevents another
  // owner from claiming the new switch before its first use.
  const training = await db.moveInTrainingControl.findUnique({where:{organisationId}});
  const controllerUserId = control?.controllerUserId ?? training?.controllerUserId;
  let canToggle=false;
  try { const user=await owner(db,userId); canToggle=user.organisationId===organisationId && (!controllerUserId || controllerUserId===userId); } catch { /* Read-only for managers. */ }
  const maintenance=await db.facialPhotoMaintenance.findUnique({where:{id:"expiry"}});
  const storageReady=integrationEncryptionConfigured();
  const maintenanceReady=Boolean(maintenance && maintenance.completedAt.getTime()>=Date.now()-90*60*1000);
  return {enabled:control?.enabled ?? Boolean(facialPhotoPolicy(organisationId)),version:control?.version ?? 0,canToggle,storageReady,maintenanceReady,reviewStatus:control ? "Interim — awaiting review" : "Interim settings ready for owner activation"};
}
export async function setPhotoCollection(userId: string, enabled: boolean, version: number) {
  const auth=await owner(db,userId);
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${auth.organisationId} FOR UPDATE`;
    const current=await owner(tx,userId);
    if (current.organisationId!==auth.organisationId) throw new Error("FORBIDDEN");
    const control=await tx.facialPhotoControl.findUnique({where:{organisationId:current.organisationId}});
    const training=await tx.moveInTrainingControl.findUnique({where:{organisationId:current.organisationId}});
    const controller=control?.controllerUserId ?? training?.controllerUserId;
    if (controller && controller!==userId) throw new Error("FORBIDDEN");
    if ((control?.version ?? 0)!==version) throw new Error("PHOTO_CONTROL_CHANGED");
    if (enabled) {
      const maintenance=await tx.facialPhotoMaintenance.findUnique({where:{id:"expiry"}});
      if (!integrationEncryptionConfigured() || !maintenance || maintenance.completedAt.getTime()<Date.now()-90*60*1000) throw new Error("PHOTO_SETUP_REQUIRED");
    }
    await tx.facialPhotoControl.upsert({where:{organisationId:current.organisationId},create:{organisationId:current.organisationId,controllerUserId:userId,enabled},update:{enabled,version:{increment:1}}});
    await tx.auditEvent.create({data:{organisationId:current.organisationId,actorId:userId,action:enabled ? "facial_photo.collection_enabled" : "facial_photo.collection_disabled",entityType:"FacialPhotoControl",entityId:current.organisationId,after:{enabled,version:version+1,policy:interimPhotoPolicy,gateActivation:false}}});
  });
  return photoControlSnapshot(auth.organisationId,userId);
}
