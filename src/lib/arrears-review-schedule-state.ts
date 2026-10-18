import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "./scope";
import { currentRoleAccess } from "./current-role-access";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { ARREARS_REVIEW_SCHEDULE, arrearsReviewScheduleInput } from "./arrears-review-schedule-policy";

type Tx = Prisma.TransactionClient;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const lastSchema = z.object({ day: z.iso.date(), at: z.iso.datetime(), outcome: z.enum(["PREPARED", "ALREADY_PREPARED", "HELD", "EXPIRED"]), taskId: z.string().nullable(), reasons: z.array(z.string().max(500)).max(10) }).strict();
const stateSchema = z.object({ revision: z.uuid(), accountId: z.cuid(), creatorId: z.cuid(), creatorName: z.string().min(1).max(160), input: arrearsReviewScheduleInput, status: z.enum(["ACTIVE", "CANCELLED", "EXPIRED"]), nextDueAt: z.iso.datetime(), last: lastSchema.nullable() }).strict();
export type ArrearsReviewScheduleState = z.infer<typeof stateSchema>;
type Row = { id: string; organisationId: string; facilityId: string | null; domain: string; status: string; config: Prisma.JsonValue };
export const arrearsReviewPlanId = (organisationId: string, accountId: string) => `arrears-review-plan:${createHash("sha256").update(JSON.stringify([organisationId, accountId])).digest("hex")}`;
const mac = (value: unknown) => {
  const key = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) throw Error("ARREARS_REVIEW_SCHEDULE_VAULT");
  return createHmac("sha256", key).update("arrears-review-schedule-v1:").update(JSON.stringify(value)).digest("hex");
};
export function decodeArrearsReviewPlan(row: Row) {
  const config = z.object({ version: z.literal(1), encrypted: z.string(), integrity: hash, nextDueAt: z.iso.datetime() }).strict().parse(row.config);
  const frame = z.object({ id: z.string(), organisationId: z.cuid(), facilityId: z.cuid(), state: stateSchema }).strict().parse(JSON.parse(decryptIntegrationSecret(config.encrypted)));
  if (row.domain !== ARREARS_REVIEW_SCHEDULE || frame.id !== row.id || frame.organisationId !== row.organisationId || frame.facilityId !== row.facilityId || frame.state.status !== row.status || frame.state.nextDueAt !== config.nextDueAt || mac(frame) !== config.integrity || row.id !== arrearsReviewPlanId(row.organisationId, frame.state.accountId)) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
  return frame.state;
}
export async function readArrearsReviewPlan(tx: Tx, organisationId: string, accountId: string) {
  const row = await tx.configurationProfile.findFirst({ where: { id: arrearsReviewPlanId(organisationId, accountId), organisationId, domain: ARREARS_REVIEW_SCHEDULE } });
  return row ? { row, state: decodeArrearsReviewPlan(row) } : null;
}
export async function saveArrearsReviewPlan(tx: Tx, row: { id: string; organisationId: string; facilityId: string }, incoming: ArrearsReviewScheduleState, exists: boolean) {
  const state = stateSchema.parse(incoming);
  const frame = { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId, state };
  const data = { status: state.status, config: { version: 1, encrypted: encryptIntegrationSecret(JSON.stringify(frame)), integrity: mac(frame), nextDueAt: state.nextDueAt } };
  return exists ? tx.configurationProfile.update({ where: { id: row.id }, data }) : tx.configurationProfile.create({ data: { ...row, domain: ARREARS_REVIEW_SCHEDULE, name: row.id, ...data } });
}
export const reviewSchedulePermissions = ["collections.view", "collections.manage", "operations.view", "operations.manage"];
export async function arrearsReviewScheduleActor(tx: Tx, scope: RequestScope, facilityId: string): Promise<RequestScope> {
  if (!scope.unrestrictedFacilities && !scope.facilityIds.includes(facilityId)) throw Error("FORBIDDEN");
  const user = await tx.user.findFirst({ where: { id: scope.userId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user || !reviewSchedulePermissions.every(key => currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), key, facilityId).allowed)) throw Error("FORBIDDEN");
  return { userId: user.id, organisationId: user.organisationId, facilityIds: [facilityId], unrestrictedFacilities: false };
}
