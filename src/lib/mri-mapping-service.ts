import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { emptyMriMapping, mappingBlockers, mriMappingSchema, type MriMapping } from "@/lib/mri-mapping-policy";

export type MriMappingLane = "primary" | "sandbox";
const domainFor = (lane: MriMappingLane) => lane === "sandbox" ? "MRI_SANDBOX_JOURNAL_MAPPING" : "MRI_JOURNAL_MAPPING";
const profileId = (org: string, lane: MriMappingLane) => `${lane === "sandbox" ? "mri-sandbox-mapping" : "mri-journal-mapping"}:${org}`;
const storedSchema = z.object({ version: z.literal(1), revision: z.string().uuid(), mapping: mriMappingSchema, contributors: z.array(z.string()).min(1), submittedBy: z.string().nullable(), approvedBy: z.string().nullable(), approvedAt: z.string().datetime().nullable(), approvalReference: z.string().max(240).nullable() }).strict();
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), revision: z.string().uuid().nullable(), mapping: mriMappingSchema }).strict(),
  z.object({ action: z.literal("submit"), revision: z.string().uuid() }).strict(),
  z.object({ action: z.literal("approve"), revision: z.string().uuid(), approvalReference: z.string().trim().min(3).max(240) }).strict(),
]);
function guard(scope: RequestScope) { if (!scope.unrestrictedFacilities) throw new Error("MRI_ORG_PERMISSION"); }
async function load(tx: Prisma.TransactionClient, scope: RequestScope, lane: MriMappingLane) {
  const rows = await tx.configurationProfile.findMany({ where: { organisationId: scope.organisationId, facilityId: null, domain: domainFor(lane) }, take: 2 });
  if (rows.length > 1) throw new Error("MRI_MAPPING_DUPLICATE");
  const row = rows[0];
  if (row && (row.id !== profileId(scope.organisationId, lane) || !["DRAFT", "IN_REVIEW", "APPROVED"].includes(row.status) || !storedSchema.safeParse(row.config).success)) throw new Error("MRI_MAPPING_VERSION");
  return row ?? null;
}
function view(row: Awaited<ReturnType<typeof load>>, scope: RequestScope) {
  const value = row ? storedSchema.parse(row.config) : null;
  const mapping = value?.mapping ?? emptyMriMapping();
  return { revision: value?.revision ?? null, status: row?.status ?? "DRAFT", mapping, blockers: mappingBlockers(mapping),
    approvedAt: value?.approvedAt ?? null, approvalReference: value?.approvalReference ?? null,
    canApprove: row?.status === "IN_REVIEW" && !value?.contributors.includes(scope.userId) && value?.submittedBy !== scope.userId,
    postingEnabled: false as const };
}
export async function mriMappingReview(scope: RequestScope, lane: MriMappingLane = "primary") {
  guard(scope); return view(await load(db, scope, lane), scope);
}
export async function readMriMappingInTransaction(tx: Prisma.TransactionClient, scope: RequestScope, lane: MriMappingLane) {
  guard(scope); return view(await load(tx, scope, lane), scope);
}
/** Local finance setup only: deliberately no provider, ledger, payment or outbox operations. */
export async function changeMriMapping(scope: RequestScope, input: unknown, lane: MriMappingLane = "primary") {
  guard(scope);
  const command = commandSchema.parse(input);
  return db.$transaction(async tx => {
    const old = await load(tx, scope, lane), previous = old ? storedSchema.parse(old.config) : null;
    if ((previous?.revision ?? null) !== command.revision) throw new Error("MRI_MAPPING_CHANGED");
    if (command.action !== "save" && !previous) throw new Error("MRI_MAPPING_CHANGED");
    let status = old?.status ?? "DRAFT";
    let mapping: MriMapping = previous?.mapping ?? emptyMriMapping();
    let contributors = previous?.contributors ?? [];
    let submittedBy = previous?.submittedBy ?? null, approvedBy = previous?.approvedBy ?? null;
    let approvedAt = previous?.approvedAt ?? null, approvalReference = previous?.approvalReference ?? null;
    if (command.action === "save") {
      mapping = command.mapping; contributors = [...new Set([...contributors, scope.userId])];
      status = "DRAFT"; submittedBy = approvedBy = approvedAt = approvalReference = null;
    } else {
      if (mappingBlockers(mapping).length) throw new Error("MRI_MAPPING_INCOMPLETE");
      if (command.action === "submit") {
        if (status !== "DRAFT") throw new Error("MRI_MAPPING_STATE");
        status = "IN_REVIEW"; submittedBy = scope.userId;
      } else {
        if (status !== "IN_REVIEW") throw new Error("MRI_MAPPING_STATE");
        if (contributors.includes(scope.userId) || submittedBy === scope.userId) throw new Error("MRI_MAPPING_SELF_APPROVAL");
        status = "APPROVED"; approvedBy = scope.userId; approvedAt = new Date().toISOString(); approvalReference = command.approvalReference;
      }
    }
    const config = { version: 1, revision: randomUUID(), mapping, contributors, submittedBy, approvedBy, approvedAt, approvalReference };
    const saved = old ? await tx.configurationProfile.update({ where: { id: old.id }, data: { status, config } }) : await tx.configurationProfile.create({ data: { id: profileId(scope.organisationId, lane), organisationId: scope.organisationId, domain: domainFor(lane), name: "MRI journal mapping", status, config } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: `mri.${lane === "sandbox" ? "sandbox.mapping" : "mapping"}.${command.action}`, entityType: "ConfigurationProfile", entityId: saved.id,
      ...(old ? { before: { status: old.status, config: old.config } } : {}), after: { status, config, postingEnabled: false } } });
    return view(saved, scope);
  }, { isolationLevel: "Serializable" });
}
