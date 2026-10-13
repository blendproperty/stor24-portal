import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { mriMonthRange } from "@/lib/mri-policy";
import { mriMappingSchema } from "@/lib/mri-mapping-policy";
import { readMriMappingInTransaction } from "@/lib/mri-mapping-service";
import { compileSandboxJournal, fingerprint, sandboxBatchInput, sandboxSourceSchema, sandboxJournalCsv } from "@/lib/mri-batch-policy";

const domain = "MRI_SANDBOX_BATCH", idFor = (org: string, period: string) => `mri-sandbox-batch:${org}:${period}`;
const snapshotSchema = z.object({ version: z.literal(1), revision: z.string().uuid(), period: z.string(), source: sandboxSourceSchema, mapping: mriMappingSchema, mappingRevision: z.string().uuid().nullable(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), contributors: z.array(z.string()).min(1), submittedBy: z.string().nullable(), approvedBy: z.string().nullable(), approvalReference: z.string().nullable(), approvedAt: z.string().datetime().nullable() }).strict();
const transitionSchema = z.object({ action: z.enum(["submit", "approve", "reopen", "void"]), period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), revision: z.string().uuid(), reference: z.string().trim().min(3).max(240) }).strict();
function guard(scope: RequestScope) { if (!scope.unrestrictedFacilities) throw Error("MRI_ORG_PERMISSION"); }
function hashOf(value: Pick<z.infer<typeof snapshotSchema>, "period" | "source" | "mapping" | "mappingRevision">) { return fingerprint({ period: value.period, source: value.source, mapping: value.mapping, mappingRevision: value.mappingRevision }); }
async function load(tx: Prisma.TransactionClient, scope: RequestScope, period: string) {
  const row = await tx.configurationProfile.findUnique({ where: { id: idFor(scope.organisationId, period) } });
  if (!row) return null;
  if (row.organisationId !== scope.organisationId || row.facilityId || row.domain !== domain || !["DRAFT", "IN_REVIEW", "APPROVED", "VOID"].includes(row.status)) throw Error("MRI_BATCH_INTEGRITY");
  const value = snapshotSchema.safeParse(row.config);
  if (!value.success || value.data.period !== period || hashOf(value.data) !== value.data.snapshotHash) throw Error("MRI_BATCH_INTEGRITY");
  return { row, snapshot: value.data };
}
async function view(tx: Prisma.TransactionClient, scope: RequestScope, period: string) {
  const saved = await load(tx, scope, period), current = await readMriMappingInTransaction(tx, scope, "sandbox");
  const preview = saved ? compileSandboxJournal(saved.snapshot.source, saved.snapshot.mapping) : null;
  const mappingCurrent = Boolean(saved && current.status === "APPROVED" && saved.snapshot.mappingRevision === current.revision && !current.blockers.length);
  const blockers = [...(preview?.blockers ?? [])];
  if (!mappingCurrent) blockers.push("An independently approved, unchanged sandbox mapping is required. Save the draft again after mappings are ready.");
  if (mriMonthRange(period).partial) blockers.push("Close the calendar month before submitting or approving the batch.");
  if (preview && !preview.balanced) blockers.push("The batch must contain nonzero, exactly balanced debit and credit totals.");
  return { period, status: saved?.row.status ?? "NOT_CREATED", revision: saved?.snapshot.revision ?? null, source: saved?.snapshot.source ?? null, preview, blockers, snapshotHash: saved?.snapshot.snapshotHash ?? null,
    approvedAt: saved?.snapshot.approvedAt ?? null, approvalReference: saved?.snapshot.approvalReference ?? null,
    canApprove: saved?.row.status === "IN_REVIEW" && !saved.snapshot.contributors.includes(scope.userId) && saved.snapshot.submittedBy !== scope.userId,
    mappingCurrent, postingEnabled: false };
}
export async function mriBatchReview(scope: RequestScope, period: string) {
  guard(scope); mriMonthRange(period);
  return db.$transaction(tx => view(tx, scope, period), { isolationLevel: "RepeatableRead" });
}
export async function saveMriBatch(scope: RequestScope, input: unknown) {
  guard(scope); const command = sandboxBatchInput.parse(input); mriMonthRange(command.period);
  return db.$transaction(async tx => {
    const old = await load(tx, scope, command.period);
    if ((old?.snapshot.revision ?? null) !== command.revision) throw Error("MRI_BATCH_CHANGED");
    if (old && old.row.status !== "DRAFT") throw Error("MRI_BATCH_IMMUTABLE");
    const mapping = await readMriMappingInTransaction(tx, scope, "sandbox");
    const bound = { period: command.period, source: { ...command.source, rows: [...command.source.rows].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)) }, mapping: mapping.mapping, mappingRevision: mapping.revision };
    const snapshot = { version: 1 as const, revision: randomUUID(), ...bound, snapshotHash: hashOf(bound), contributors: [...new Set([...(old?.snapshot.contributors ?? []), scope.userId])], submittedBy: null, approvedBy: null, approvalReference: null, approvedAt: null };
    const config = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
    const row = old ? await tx.configurationProfile.update({ where: { id: old.row.id }, data: { config, status: "DRAFT" } }) : await tx.configurationProfile.create({ data: { id: idFor(scope.organisationId, command.period), organisationId: scope.organisationId, domain, name: `Sandbox journal ${command.period}`, config } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "mri.sandbox.batch.saved", entityType: "ConfigurationProfile", entityId: row.id, ...(old ? { before: { status: old.row.status, snapshot: old.row.config } } : {}), after: { status: row.status, snapshot: config, postingEnabled: false } } });
    return view(tx, scope, command.period);
  }, { isolationLevel: "Serializable" });
}
export async function transitionMriBatch(scope: RequestScope, input: unknown) {
  guard(scope); const command = transitionSchema.parse(input); mriMonthRange(command.period);
  return db.$transaction(async tx => {
    const old = await load(tx, scope, command.period);
    if (!old || old.snapshot.revision !== command.revision) throw Error("MRI_BATCH_CHANGED");
    const current = await view(tx, scope, command.period);
    let status = old.row.status;
    const snapshot = { ...old.snapshot, revision: randomUUID() };
    if (command.action === "submit" || command.action === "approve") {
      if (current.blockers.length) throw Error("MRI_BATCH_BLOCKED");
      if (command.action === "submit") {
        if (status !== "DRAFT") throw Error("MRI_BATCH_STATE");
        // Global source-key reservations are scoped to the organisation and
        // sandbox domain. Another period cannot consume the same source twice.
        for (const source of old.snapshot.source.rows) {
          const id = `mri-sandbox-source:${fingerprint([scope.organisationId, source.sourceKey])}`;
          const reservation = await tx.configurationProfile.findUnique({ where: { id } });
          if (reservation && (reservation.organisationId !== scope.organisationId || reservation.domain !== "MRI_SANDBOX_SOURCE" || (reservation.config as { batchId?: string }).batchId !== old.row.id)) throw Error("MRI_BATCH_DUPLICATE_SOURCE");
          if (!reservation) await tx.configurationProfile.create({ data: { id, organisationId: scope.organisationId, domain: "MRI_SANDBOX_SOURCE", name: source.sourceKey, status: "RESERVED", config: { batchId: old.row.id } } });
        }
        status = "IN_REVIEW"; snapshot.submittedBy = scope.userId;
      } else {
        if (status !== "IN_REVIEW") throw Error("MRI_BATCH_STATE");
        if (!current.canApprove) throw Error("MRI_BATCH_SELF_APPROVAL");
        status = "APPROVED"; snapshot.approvedBy = scope.userId; snapshot.approvedAt = new Date().toISOString(); snapshot.approvalReference = command.reference;
      }
    } else if (command.action === "reopen") {
      if (status !== "IN_REVIEW") throw Error("MRI_BATCH_IMMUTABLE");
      status = "DRAFT"; snapshot.submittedBy = null;
    } else {
      if (status === "VOID") throw Error("MRI_BATCH_IMMUTABLE");
      status = "VOID";
    }
    const config = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
    await tx.configurationProfile.update({ where: { id: old.row.id }, data: { status, config } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: `mri.sandbox.batch.${command.action}`, entityType: "ConfigurationProfile", entityId: old.row.id, before: { status: old.row.status, snapshot: old.row.config }, after: { status, snapshot: config, reference: command.reference, postingEnabled: false } } });
    return view(tx, scope, command.period);
  }, { isolationLevel: "Serializable" });
}
export async function mriBatchCsv(scope: RequestScope, period: string, revision: string) {
  guard(scope); mriMonthRange(period);
  return db.$transaction(async tx => {
    const saved = await load(tx, scope, period), current = await view(tx, scope, period);
    if (!saved || current.revision !== revision) throw Error("MRI_BATCH_CHANGED");
    if (current.status !== "APPROVED" || current.blockers.length || !current.preview) throw Error("MRI_BATCH_BLOCKED");
    return sandboxJournalCsv(period, saved.snapshot.mapping, current.preview, saved.snapshot.snapshotHash);
  }, { isolationLevel: "RepeatableRead" });
}
