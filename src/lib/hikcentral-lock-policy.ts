import { z } from "zod";
import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";

const schema = z.object({
  facilityId: z.string().cuid(),
  approvalReference: z.string().trim().min(8).max(240),
  warningText: z.string().trim().min(40).max(1200).refine(text => text.includes("{account}") && text.includes("{lockDate}")),
  lockedText: z.string().trim().min(40).max(1200).refine(text => text.includes("{account}")),
  noticeHours: z.number().int().min(1).max(168),
}).strict();

const name = "STOR24 face access non-payment notices";
const domain = "HIKCENTRAL_FACE_LOCK_POLICY";

export async function hikCentralLockPolicy(organisationId: string, facilityId: string) {
  const row = await db.configurationProfile.findFirst({ where: { organisationId, facilityId, domain, name, status: "APPROVED" } });
  if (!row) return null;
  const parsed = schema.safeParse(row.config);
  return parsed.success && parsed.data.facilityId === facilityId ? parsed.data : null;
}

export async function saveHikCentralLockPolicy(scope: RequestScope, input: unknown) {
  if (!scope.unrestrictedFacilities || !scope.userId) throw Error("FORBIDDEN");
  const data = schema.parse(input);
  await requireFacility(scope, data.facilityId);
  const previous = await db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: data.facilityId, domain, name } });
  const row = previous
    ? await db.configurationProfile.update({ where: { id: previous.id }, data: { status: "APPROVED", config: data } })
    : await db.configurationProfile.create({ data: { organisationId: scope.organisationId, facilityId: data.facilityId, domain, name, status: "APPROVED", config: data } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: data.facilityId, actorId: scope.userId, action: "hikcentral_face.lock_policy_approved", entityType: "ConfigurationProfile", entityId: row.id, after: { approvalReference: data.approvalReference, noticeHours: data.noticeHours, warningText: data.warningText, lockedText: data.lockedText } } });
  return data;
}

export async function disableHikCentralLockPolicy(scope: RequestScope, facilityId: string) {
  if (!scope.unrestrictedFacilities || !scope.userId) throw Error("FORBIDDEN");
  await requireFacility(scope, facilityId);
  const row = await db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId, domain, name, status: "APPROVED" } });
  if (!row) return;
  await db.configurationProfile.update({ where: { id: row.id }, data: { status: "DISABLED" } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "hikcentral_face.lock_policy_disabled", entityType: "ConfigurationProfile", entityId: row.id } });
}
