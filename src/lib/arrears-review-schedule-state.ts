import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "./scope";
import { currentRoleAccess } from "./current-role-access";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { ARREARS_REVIEW_CURSOR, ARREARS_REVIEW_SCHEDULE, arrearsReviewScheduleInput } from "./arrears-review-schedule-policy";

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
  const config = z.object({ version: z.literal(1), encrypted: z.string().max(32768), integrity: hash, nextDueAt: z.iso.datetime() }).strict().parse(row.config);
  const frame = z.object({ id: z.string(), organisationId: z.cuid(), facilityId: z.cuid(), state: stateSchema }).strict().parse(JSON.parse(decryptIntegrationSecret(config.encrypted)));
  if (row.domain !== ARREARS_REVIEW_SCHEDULE || frame.id !== row.id || frame.organisationId !== row.organisationId || frame.facilityId !== row.facilityId || frame.state.status !== row.status || frame.state.nextDueAt !== config.nextDueAt || mac(frame) !== config.integrity || row.id !== arrearsReviewPlanId(row.organisationId, frame.state.accountId)) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
  return frame.state;
}
export async function readArrearsReviewPlan(tx: Tx, organisationId: string, accountId: string) {
  const row = await tx.configurationProfile.findUnique({ where: { id: arrearsReviewPlanId(organisationId, accountId) } });
  if (row && (row.organisationId !== organisationId || row.domain !== ARREARS_REVIEW_SCHEDULE)) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
  return row ? { row, state: decodeArrearsReviewPlan(row) } : null;
}

const leaseSchema = z.object({ token: z.uuid(), until: z.iso.datetime() }).strict();
const cursorValue = z.object({ cursor: z.string().regex(/^arrears-review-plan:[a-f0-9]{64}$/).nullable(), lease: leaseSchema.nullable() }).strict();
const cursorSchema = cursorValue.safeExtend({ version: z.literal(1), integrity: hash });
export type ArrearsReviewCursorState = z.infer<typeof cursorValue>;
const cursorId = (organisationId: string) => `arrears-review-cursor:${organisationId}`;
export async function readArrearsReviewCursor(tx: Tx, organisationId: string) {
  const row = await tx.configurationProfile.findUnique({ where: { id: cursorId(organisationId) } });
  if (!row) return null;
  const value = cursorSchema.parse(row.config);
  if (row.organisationId !== organisationId || row.facilityId !== null || row.domain !== ARREARS_REVIEW_CURSOR || row.status !== "ACTIVE" || value.integrity !== mac(["cursor", organisationId, value.cursor, value.lease])) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
  return { cursor: value.cursor, lease: value.lease };
}
export async function saveArrearsReviewCursor(tx: Tx, organisationId: string, incoming: ArrearsReviewCursorState) {
  const id = cursorId(organisationId), existing = await tx.configurationProfile.findUnique({ where: { id } });
  if (existing && (existing.organisationId !== organisationId || existing.facilityId !== null || existing.domain !== ARREARS_REVIEW_CURSOR || existing.status !== "ACTIVE")) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
  const value = cursorValue.parse(incoming);
  const config = cursorSchema.parse({ version: 1, ...value, integrity: mac(["cursor", organisationId, value.cursor, value.lease]) });
  return existing ? tx.configurationProfile.update({ where: { id }, data: { config } }) : tx.configurationProfile.create({ data: { id, organisationId, facilityId: null, domain: ARREARS_REVIEW_CURSOR, name: id, status: "ACTIVE", config } });
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
