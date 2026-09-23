import { createHash } from "node:crypto";
import sharp from "sharp";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { advanceTraining, initialTrainingState, type TrainingAction, type TrainingState } from "@/lib/move-in-training-contract";
import { normaliseFacialPhoto } from "@/lib/facial-photo-security";
type Database = Prisma.TransactionClient;

// Re-read current database roles for every request; never trust a role cached in a session token.
export async function trainingAccess(database: Database, userId: string) {
  const user = await database.user.findUnique({ where:{id:userId}, include:{roleAssignments:{include:{role:true,facility:true}}} });
  if (!user?.active) throw new Error("FORBIDDEN");
  const assignments = user.roleAssignments.filter(a => a.role.organisationId === user.organisationId && (!a.facility || a.facility.organisationId === user.organisationId));
  const owner = assignments.some(a => a.role.name === "Organisation owner" && !a.facilityId);
  // Customising a manager replaces the named role. Keep their current move-in grant
  // and assigned facilities authoritative without granting any live permissions.
  const managers = assignments.filter(a => a.role.name === "Facility manager" ||
    (a.role.name === `Custom access · ${user.id}` && hasPermission(a.role.permissions, "move_in.create")));
  if (!owner && !managers.length) throw new Error("FORBIDDEN");
  const facilities = await database.facility.findMany({ where:{organisationId:user.organisationId, ...(!owner && !managers.some(a=>!a.facilityId) ? { id:{in:managers.flatMap(a=>a.facilityId ? [a.facilityId] : [])} } : {})}, select:{id:true,name:true}, orderBy:{name:"asc"} });
  return { userId:user.id, organisationId:user.organisationId, owner, facilities };
}
export async function trainingSnapshot(userId: string, facilityId?: string) {
  const access = await trainingAccess(db,userId);
  const control = await db.moveInTrainingControl.findUnique({where:{organisationId:access.organisationId}});
  const canToggle = access.owner && (!control || control.controllerUserId === userId);
  const selected = facilityId && access.facilities.some(f=>f.id===facilityId) ? facilityId : access.facilities[0]?.id;
  const run = selected && control?.enabled ? await db.moveInTrainingRun.findFirst({where:{organisationId:access.organisationId,userId,facilityId:selected,generation:control.generation}}) : null;
  return { enabled:control?.enabled ?? false, controlVersion:control?.version ?? 0, canToggle, facilities:access.facilities, facilityId:selected ?? "", run:run ? {version:run.version,state:run.state as TrainingState} : null };
}
export type TrainingSnapshot = Awaited<ReturnType<typeof trainingSnapshot>>;
export async function trainingCommand(userId: string, input: TrainingAction, sampleValidated = false) {
  const access = await trainingAccess(db,userId);
  await db.$transaction(async tx => {
    // Same lock for enable/disable and every transition: disabling cannot race a handover.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${access.organisationId} FOR UPDATE`;
    const current = await trainingAccess(tx,userId);
    if (current.organisationId !== access.organisationId) throw new Error("FORBIDDEN");
    const control = await tx.moveInTrainingControl.findUnique({where:{organisationId:current.organisationId}});
    if (input.action === "toggle") {
      if (!current.owner || (control && control.controllerUserId !== userId)) throw new Error("FORBIDDEN");
      if ((control?.version ?? 0) !== input.version) throw new Error("TRAINING_CHANGED");
      await tx.moveInTrainingControl.upsert({where:{organisationId:current.organisationId},create:{organisationId:current.organisationId,controllerUserId:userId,enabled:input.enabled},update:{enabled:input.enabled,version:{increment:1},generation:{increment:1}}});
      await tx.auditEvent.create({data:{organisationId:current.organisationId,actorId:userId,action:input.enabled ? "training.enabled" : "training.disabled",entityType:"MoveInTrainingControl",entityId:current.organisationId}});
      return;
    }
    if (!control?.enabled) throw new Error("TRAINING_DISABLED");
    if (!current.facilities.some(f=>f.id===input.facilityId)) throw new Error("FORBIDDEN");
    const key = {organisationId:current.organisationId,userId,facilityId:input.facilityId};
    const run = await tx.moveInTrainingRun.findUnique({where:{organisationId_userId_facilityId:key}});
    if (input.action === "start") {
      if (!run || run.generation !== control.generation) await tx.moveInTrainingRun.upsert({where:{organisationId_userId_facilityId:key},create:{...key,generation:control.generation,state:initialTrainingState()},update:{generation:control.generation,version:{increment:1},state:initialTrainingState()}});
      return;
    }
    if (!run || run.generation !== control.generation || run.version !== input.version) throw new Error("TRAINING_CHANGED");
    if (input.action === "reset" && !current.owner) throw new Error("FORBIDDEN");
    if (input.action === "photo" && !sampleValidated) throw new Error("TRAINING_SAMPLE_REQUIRED");
    const state = input.action === "reset" ? initialTrainingState() : advanceTraining(run.state as TrainingState,input.action,input.action === "photo" ? "validated-sample" : input.value);
    await tx.moveInTrainingRun.update({where:{id:run.id},data:{state,version:{increment:1}}});
    await tx.auditEvent.create({data:{organisationId:current.organisationId,facilityId:input.facilityId,actorId:userId,action:`training.${input.action}`,entityType:"MoveInTrainingRun",entityId:run.id,after:{version:run.version+1,trainingOnly:true}}});
  });
  return trainingSnapshot(userId,"facilityId" in input ? input.facilityId : undefined);
}
export async function trainingSample() {
  return sharp(Buffer.from('<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="320" fill="#f5f3ea"/><circle cx="120" cy="100" r="42" fill="#ff5a0a"/><path d="M45 260v-40a75 75 0 0 1 150 0v40" fill="#071411"/></svg>')).png().toBuffer();
}
export async function validateTrainingSample(file: File) {
  const bytes = await normaliseFacialPhoto(file);
  const expected = await normaliseFacialPhoto(new File([new Uint8Array(await trainingSample())],"training.png",{type:"image/png"}));
  if (createHash("sha256").update(bytes).digest("hex") !== createHash("sha256").update(expected).digest("hex")) throw new Error("TRAINING_SAMPLE_REQUIRED");
  // Never persist uploaded image bytes. Only the provided non-person sample is accepted.
}
