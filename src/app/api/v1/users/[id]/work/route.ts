import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { sameOrigin } from "@/lib/request-security";
import { changeOperationalChecklist } from "@/lib/operational-checklist-service";
import { checklistRecordSchema } from "@/lib/operational-checklist-policy";
import { scheduledWorkPurposes } from "@/lib/scheduled-work-policy";
import { reassignOperationalForm } from "@/lib/operational-form-service";

const transfer = z.object({ taskId: z.string().cuid(), replacementId: z.string().cuid(), updatedAt: z.iso.datetime(), kind: z.enum(["TASK", "LEAD", "COLLECTION"]).default("TASK") }).strict();
const arrears = ["ARREARS_ACCESS_REVIEW", "ARREARS_ESCALATION_REVIEW"];
const supported: string[] = ["GENERAL", "AGREED_FOLLOWUP", ...scheduledWorkPurposes, ...arrears];

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireOwner();
    const { id } = await context.params;
    const target = await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, select: { id: true } });
    if (!target) return Response.json({ error: { message: "User not found." } }, { status: 404 });
    const cursor = new URL(request.url).searchParams.get("cursor");
    const parsedCursor = cursor ? z.tuple([z.enum(["TASK", "LEAD", "COLLECTION"]), z.string().cuid()]).safeParse(cursor.split(":")) : null;
    if (parsedCursor && !parsedCursor.success) return Response.json({ error: { message: "Invalid work cursor." } }, { status: 400 });
    const [cursorKind, cursorId] = parsedCursor?.success ? parsedCursor.data : ["TASK", ""];
    const [tasks, leads, collections] = await Promise.all([db.$queryRaw<{ id: string; title: string; purpose: string; status: string; updatedAt: Date; facilityName: string | null; assigneeId: string | null; createdById: string | null; coverId: string | null; reviewerId: string | null }[]>`SELECT t."id", t."title", t."purpose", t."status"::text AS "status", t."updatedAt", f."name" AS "facilityName", t."assigneeId", t."createdById", t."coverId", CASE WHEN t."purpose"='OPERATIONAL_CHECKLIST' THEN t."operationalChecklist"->>'reviewerId' WHEN t."purpose"='OPERATIONAL_FORM' THEN t."operationalForm"->>'reviewerId' END AS "reviewerId" FROM "Task" t LEFT JOIN "Facility" f ON f."id"=t."facilityId" WHERE ${cursorKind} = 'TASK' AND t."id" > ${cursorKind === "TASK" ? cursorId : ""} AND t."organisationId"=${actor.user.organisationId} AND t."status" NOT IN ('COMPLETED','CANCELLED') AND (t."assigneeId"=${id} OR t."coverId"=${id} OR (t."purpose"='OPERATIONAL_CHECKLIST' AND t."operationalChecklist"->>'reviewerId'=${id}) OR (t."purpose"='OPERATIONAL_FORM' AND (t."operationalForm"->>'reviewerId'=${id} OR (t."assigneeId" IS NULL AND t."createdById"=${id})))) ORDER BY t."id" LIMIT 201`, db.lead.findMany({ where: { id: cursorKind === "COLLECTION" ? { equals: "" } : { gt: cursorKind === "LEAD" ? cursorId : "" }, facility: { organisationId: actor.user.organisationId }, assignedToId: id, stage: { not: "LOST" } }, select: { id: true, stage: true, updatedAt: true, assignedToId: true, facility: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: { id: "asc" }, take: 201 }), db.collectionCase.findMany({ where: { id: { gt: cursorKind === "COLLECTION" ? cursorId : "" }, ownerId: id, account: { customer: { organisationId: actor.user.organisationId } } }, select: { id: true, updatedAt: true, ownerId: true, account: { select: { accountNumber: true, tenancy: { select: { facility: { select: { name: true } } } } } } }, orderBy: { id: "asc" }, take: 201 })]);
    const rows = [...tasks.map(({ facilityName, ...task }) => ({ ...task, kind: "TASK", facility: facilityName ? { name: facilityName } : null })), ...leads.map(lead => ({ ...lead, kind: "LEAD", title: `Enquiry · ${lead.customer?.companyName || [lead.customer?.firstName, lead.customer?.lastName].filter(Boolean).join(" ") || "Unlinked"} · ${lead.id}`, purpose: "LEAD", status: lead.stage, assigneeId: lead.assignedToId, coverId: null, reviewerId: null })), ...collections.map(item => ({ id: item.id, kind: "COLLECTION", title: `Collections · ${item.account.accountNumber}`, purpose: "COLLECTION", status: "Assigned", updatedAt: item.updatedAt, assigneeId: item.ownerId, coverId: null, reviewerId: null, facility: item.account.tenancy?.facility ?? null }))];
    const page = rows.slice(0, 200);
    const last = page.at(-1);
    return Response.json({ data: page, nextCursor: rows.length > 200 && last ? `${last.kind}:${last.id}` : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const actor = await requireOwner();
    const input = transfer.parse(await request.json());
    const { id } = await context.params;
    if (id === input.replacementId) return Response.json({ error: { message: "Choose another user." } }, { status: 422 });
    const form = input.kind === "TASK" ? await db.task.findFirst({ where: { id: input.taskId, organisationId: actor.user.organisationId, purpose: "OPERATIONAL_FORM" }, select: { id: true } }) : null;
    if (form) {
      if (!await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, select: { id: true } })) return Response.json({ error: { message: "User not found." } }, { status: 404 });
      await reassignOperationalForm({ userId: actor.user.id, organisationId: actor.user.organisationId, facilityIds: [], unrestrictedFacilities: true }, form.id, id, input.replacementId, input.updatedAt, actor.user.sessionVersion);
      return Response.json({ data: { reassigned: true } }, { headers: { "Cache-Control": "no-store" } });
    }
    const checklist = input.kind === "TASK" ? await db.task.findFirst({ where: { id: input.taskId, organisationId: actor.user.organisationId, purpose: "OPERATIONAL_CHECKLIST" } }) : null;
    if (checklist) {
      if (!await db.user.findFirst({ where: { id, organisationId: actor.user.organisationId }, select: { id: true } })) return Response.json({ error: { message: "User not found." } }, { status: 404 });
      const record = checklistRecordSchema.safeParse(checklist.operationalChecklist);
      if (!record.success || !checklist.assigneeId || checklist.updatedAt.toISOString() !== input.updatedAt || (checklist.assigneeId !== id && checklist.coverId !== id && record.data.reviewerId !== id)) return Response.json({ error: { message: "The checklist changed. Refresh the review and try again." } }, { status: 409 });
      await changeOperationalChecklist({ userId: actor.user.id, organisationId: actor.user.organisationId, facilityIds: [], unrestrictedFacilities: true }, { id: checklist.id, action: "ASSIGN", expectedUpdatedAt: input.updatedAt, assigneeId: checklist.assigneeId === id ? input.replacementId : checklist.assigneeId, coverId: checklist.coverId === id ? input.replacementId : checklist.coverId, reviewerId: record.data.reviewerId === id ? input.replacementId : record.data.reviewerId }, new Date(), actor.user.sessionVersion);
      return Response.json({ data: { reassigned: true } }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await db.$transaction(async tx => {
      const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(143, 2441) AS acquired`;
      if (!acquired) return "busy";
      const lockedUsers = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "organisationId" = ${actor.user.organisationId} AND "id" IN (${actor.user.id}, ${id}, ${input.replacementId}) ORDER BY "id" FOR UPDATE SKIP LOCKED`;
      if (lockedUsers.length !== new Set([actor.user.id, id, input.replacementId]).size) return "user";
      const current = await tx.user.findFirst({ where: { id: actor.user.id, organisationId: actor.user.organisationId }, include: { roleAssignments: { include: { role: true } } } });
      if (!current?.active || !current.passwordHash || current.sessionVersion !== actor.user.sessionVersion || !currentRoleAccess(current.roleAssignments).owner) throw new Error("FORBIDDEN");
      const target = await tx.user.findFirst({ where: { id, organisationId: current.organisationId } });
      const replacement = await tx.user.findFirst({ where: { id: input.replacementId, organisationId: current.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
      if (!target || !replacement || !replacement.passwordHash) return "user";
      if (input.kind === "COLLECTION") {
        const candidate = await tx.collectionCase.findFirst({ where: { id: input.taskId, account: { customer: { organisationId: current.organisationId } } }, select: { accountId: true } });
        if (!candidate) return "changed";
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Account" WHERE "id" = ${candidate.accountId} FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return "busy";
        const item = await tx.collectionCase.findFirst({ where: { id: input.taskId, account: { customer: { organisationId: current.organisationId } } }, include: { account: { include: { tenancy: { include: { facility: { select: { organisationId: true } } } } } } } });
        if (!item?.account.tenancy || item.account.tenancy.facility.organisationId !== current.organisationId || item.ownerId !== id || item.updatedAt.toISOString() !== input.updatedAt) return "changed";
        if (!currentRoleAccess(replacement.roleAssignments.filter(a => a.role.organisationId === current.organisationId), "collections.manage", item.account.tenancy.facilityId).allowed) return "access";
        const changed = await tx.collectionCase.updateMany({ where: { id: item.id, ownerId: id, revision: item.revision, updatedAt: item.updatedAt }, data: { ownerId: replacement.id, revision: { increment: 1 }, updatedAt: new Date(Math.max(Date.now(), item.updatedAt.getTime() + 1)) } });
        if (changed.count !== 1) return "changed";
        await tx.auditEvent.create({ data: { organisationId: current.organisationId, facilityId: item.account.tenancy.facilityId, actorId: current.id, action: "staff.collection_reassigned", entityType: "CollectionCase", entityId: item.id, before: { ownerId: id, revision: item.revision }, after: { ownerId: replacement.id, revision: item.revision + 1 } } });
        return "ok";
      }
      if (input.kind === "LEAD") {
        const lockedLead = await tx.$queryRaw<{ id: string }[]>`SELECT lead."id" FROM "Lead" lead JOIN "Facility" facility ON facility."id" = lead."facilityId" WHERE lead."id" = ${input.taskId} AND facility."organisationId" = ${current.organisationId} FOR UPDATE OF lead SKIP LOCKED`;
        if (!lockedLead.length) return "busy";
        const lead = await tx.lead.findFirst({ where: { id: input.taskId, facility: { organisationId: current.organisationId } } });
        if (!lead || lead.stage === "LOST" || lead.assignedToId !== id || lead.updatedAt.toISOString() !== input.updatedAt) return "changed";
        if (!currentRoleAccess(replacement.roleAssignments.filter(a => a.role.organisationId === current.organisationId), "leads.view", lead.facilityId).allowed) return "access";
        const changed = await tx.lead.updateMany({ where: { id: lead.id, assignedToId: id, updatedAt: lead.updatedAt, stage: lead.stage }, data: { assignedToId: replacement.id, updatedAt: new Date(Math.max(Date.now(), lead.updatedAt.getTime() + 1)) } });
        if (changed.count !== 1) return "changed";
        await tx.auditEvent.create({ data: { organisationId: current.organisationId, facilityId: lead.facilityId, actorId: current.id, action: "staff.lead_reassigned", entityType: "Lead", entityId: lead.id, before: { assignedToId: id }, after: { assignedToId: replacement.id } } });
        return "ok";
      }
      const lockedTask = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Task" WHERE "id" = ${input.taskId} AND "organisationId" = ${current.organisationId} FOR UPDATE SKIP LOCKED`;
      if (!lockedTask.length) return "busy";
      const task = await tx.task.findFirst({ where: { id: input.taskId, organisationId: current.organisationId } });
      if (!task || !supported.includes(task.purpose) || ["COMPLETED", "CANCELLED"].includes(task.status) || (task.assigneeId !== id && task.coverId !== id) || task.updatedAt.toISOString() !== input.updatedAt) return "changed";
      const access = currentRoleAccess(replacement.roleAssignments.filter(a => a.role.organisationId === current.organisationId), "operations.view", task.facilityId ?? undefined);
      if (!access.allowed || (!task.facilityId && access.allowedFacilityIds !== null)) return "access";
      if (arrears.includes(task.purpose) && (!task.facilityId || !["collections.view", "collections.manage", "operations.view", "operations.manage"].every(permission => currentRoleAccess(replacement.roleAssignments.filter(a => a.role.organisationId === current.organisationId), permission, task.facilityId!).allowed))) return "access";
      const assigneeId = task.assigneeId === id ? replacement.id : task.assigneeId;
      const coverId = task.coverId === id ? replacement.id : task.coverId;
      if (assigneeId && assigneeId === coverId) return "duplicate";
      const changed = await tx.task.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, status: task.status, assigneeId: task.assigneeId, coverId: task.coverId }, data: { assigneeId, coverId, coverAcknowledgedAt: null, updatedAt: new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1)) } });
      if (changed.count !== 1) return "changed";
      await tx.auditEvent.create({ data: { organisationId: current.organisationId, facilityId: task.facilityId, actorId: current.id, action: "staff.task_reassigned", entityType: "Task", entityId: task.id, before: { assigneeId: task.assigneeId, coverId: task.coverId }, after: { assigneeId, coverId } } });
      return "ok";
    }, { isolationLevel: "Serializable", timeout: 10000 });
    if (result !== "ok") return Response.json({ error: { message: result === "access" ? "The replacement cannot view work at this facility." : result === "duplicate" ? "The same person cannot be both assignee and cover." : result === "busy" ? "Another change is in progress. Try again shortly." : "The user or task changed. Refresh the review and try again." } }, { status: 409 });
    return Response.json({ data: { reassigned: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return Response.json({ error: { message: "The work changed concurrently. Refresh the review and try again." } }, { status: 409 });
    if (error instanceof Error && ["CONFLICT", "FORM_REVIEWER_REQUIRED", "CHECKLIST_REVIEWER_REQUIRED", "CHECKLIST_PADLOCK_REVIEWER_REQUIRED", "NOT_FOUND"].includes(error.message)) return Response.json({ error: { message: "The record changed or the replacement does not meet its independent-review requirements. Refresh and choose an eligible person." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
