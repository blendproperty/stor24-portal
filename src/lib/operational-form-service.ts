import { createHash } from "node:crypto";
import sharp from "sharp";
import { db } from "./db";
import { currentRoleAccess } from "./current-role-access";
import { facilityWhere, type RequestScope } from "./scope";
import type { Prisma } from "@/generated/prisma/client";
import { FORM_PURPOSE, formCreateSchema, formChangeSchema, formRecordSchema, formTemplate, initialFormValues, validateFormValues, type FormChange, type OperationalFormRecord } from "./operational-form-policy";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const summarySelect = { id: true, title: true, facilityId: true, createdById: true, status: true, updatedAt: true, createdAt: true, facility: { select: { name: true } }, assignee: { select: { name: true } } } as const;
async function actor(tx: Prisma.TransactionClient, scope: RequestScope) {
  const user = await tx.user.findFirst({ where: { id: scope.userId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user) throw Error("FORBIDDEN");
  return user;
}
function access(user: Awaited<ReturnType<typeof actor>>, organisationId: string, facilityId: string, permission = "operations.view") {
  const roles = user.roleAssignments.filter(r => r.role.organisationId === organisationId);
  return ["operations.view",permission].every(p => currentRoleAccess(roles,p,facilityId).allowed);
}
const auditRecord = (record: OperationalFormRecord) => ({ ...record, photos: record.photos.map(p => ({ name: p.name, sha256: hash(p.data) })) });
export async function createOperationalForm(scope: RequestScope, raw: unknown) {
  const input = formCreateSchema.parse(raw), template = formTemplate(input.kind);
  if (template.captureHeld) throw Error("FORM_APPROVAL_REQUIRED");
  return db.$transaction(async tx => {
    const user = await actor(tx,scope);
    const facility = await tx.facility.findFirst({ where: { ...facilityWhere(scope), id: input.facilityId, active: true } });
    if (!facility || !access(user,scope.organisationId,facility.id,input.kind === "MAINTENANCE" ? "operations.view" : "operations.manage")) throw Error("FORBIDDEN");
    const requestKey = `operational-form:${input.requestKey}`, requestHash = hash({ ...input, actor: scope.userId });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey},0))`;
    const prior = await tx.task.findUnique({ where: { requestKey } });
    if (prior) {
      if (prior.organisationId !== scope.organisationId || prior.requestHash !== requestHash) throw Error("CONFLICT");
      return { id: prior.id };
    }
    const record = formRecordSchema.parse({ version: 1, kind: input.kind, values: initialFormValues(input.kind), photos: [], reviewerId: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: "" });
    const task = await tx.task.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, createdById: scope.userId, assigneeId: scope.userId, title: template.name, purpose: FORM_PURPOSE, requestKey, requestHash, operationalForm: json(record) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, actorId: scope.userId, action: "operationalForm.create", entityType: "Task", entityId: task.id, after: json({ kind: input.kind, status: task.status }) } });
    return { id: task.id };
  }, { timeout: 30000 });
}
async function normalisePhotos(photos: OperationalFormRecord["photos"], previous: OperationalFormRecord["photos"]) {
  const result: OperationalFormRecord["photos"] = [];
  for (const photo of photos) {
    if (previous.some(p => p.data === photo.data)) { result.push(photo); continue; }
    try {
      const bytes = Buffer.from(photo.data.split(",")[1],"base64");
      const image = sharp(bytes,{ limitInputPixels: 10000000, failOn: "error" });
      const meta = await image.metadata();
      if (meta.format !== "jpeg" || (meta.pages ?? 1) > 1) throw Error("FORM_INVALID_PHOTO");
      const normal = await image.rotate().resize({ width: 1600,height: 1600,fit: "inside",withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      if (normal.length > 300000) throw Error("FORM_INVALID_PHOTO");
      result.push({ name: photo.name,data: `data:image/jpeg;base64,${normal.toString("base64")}` });
    } catch { throw Error("FORM_INVALID_PHOTO"); }
  }
  return result;
}
export async function changeOperationalForm(scope: RequestScope, raw: FormChange) {
  const input = formChangeSchema.parse(raw);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${input.id} AND "organisationId"=${scope.organisationId} FOR UPDATE`;
    const before = await tx.task.findFirst({ where: { id: input.id, organisationId: scope.organisationId, facility: facilityWhere(scope), purpose: FORM_PURPOSE } });
    if (!before?.facilityId) throw Error("NOT_FOUND");
    const user = await actor(tx,scope), manager = access(user,scope.organisationId,before.facilityId,"operations.manage");
    if (!access(user,scope.organisationId,before.facilityId)) throw Error("FORBIDDEN");
    const record = formRecordSchema.parse(before.operationalForm), original = auditRecord(record), template = formTemplate(record.kind);
    if (template.captureHeld) throw Error("FORM_APPROVAL_REQUIRED");
    if (record.kind !== "MAINTENANCE" && !manager) throw Error("FORBIDDEN");
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt || ["COMPLETED","CANCELLED"].includes(before.status)) throw Error("CONFLICT");
    let status = before.status;
    if ("values" in input) {
      if (before.createdById !== scope.userId || !["OPEN","IN_PROGRESS"].includes(status)) throw Error("FORBIDDEN");
      if (input.action === "SUBMIT" && template.hold) throw Error("FORM_APPROVAL_REQUIRED");
      validateFormValues(record.kind,input.values,input.action === "SUBMIT");
      if (input.photos.length && !["MAINTENANCE","CERTIFICATE","ADJUDICATION"].includes(record.kind)) throw Error("FORM_INVALID_PHOTO");
      if (input.reviewerId) {
        const reviewer = await actor(tx,{ ...scope,userId: input.reviewerId });
        if (reviewer.id === scope.userId || !access(reviewer,scope.organisationId,before.facilityId,"operations.manage")) throw Error("FORM_REVIEWER_REQUIRED");
      }
      if (input.action === "SUBMIT" && !input.reviewerId) throw Error("FORM_REVIEWER_REQUIRED");
      record.values = input.values; record.photos = await normalisePhotos(input.photos,record.photos); record.reviewerId = input.reviewerId;
      if (input.action === "SUBMIT") { status = "WAITING"; record.submittedAt = new Date().toISOString(); }
    } else {
      if (!manager) throw Error("FORBIDDEN");
      if (input.action === "CANCEL") status = "CANCELLED";
      else {
        if (template.hold) throw Error("FORM_APPROVAL_REQUIRED");
        if (status !== "WAITING" || record.reviewerId !== scope.userId || before.createdById === scope.userId) throw Error("FORBIDDEN");
        validateFormValues(record.kind,record.values,true);
        status = input.action === "REVIEW" ? "COMPLETED" : "IN_PROGRESS";
        if (input.action === "REVIEW") { record.reviewedAt = new Date().toISOString(); record.reviewedBy = scope.userId; }
        else record.submittedAt = null;
      }
      record.reviewNote = input.note;
    }
    const now = new Date(Math.max(Date.now(),before.updatedAt.getTime()+1));
    const saved = await tx.task.updateMany({ where: { id: before.id,updatedAt: before.updatedAt,status: before.status },data: { status, operationalForm: json(record), completedAt: status === "COMPLETED" ? now : null,updatedAt: now } });
    if (saved.count !== 1) throw Error("CONFLICT");
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId,facilityId: before.facilityId,actorId: scope.userId,action: `operationalForm.${input.action.toLowerCase()}`,entityType: "Task",entityId: before.id,before: json({ status: before.status,record: original }),after: json({ status,record: auditRecord(record) }) } });
    return { id: before.id };
  }, { timeout: 30000 });
}
export async function operationalForms(scope: RequestScope, query: { id?: string; facilityId?: string; cursor?: string; closed?: boolean }) {
  return db.$transaction(async tx => {
    const user = await actor(tx,scope);
    const facilities = (await tx.facility.findMany({ where: facilityWhere(scope),select: { id: true,name: true },orderBy: { name: "asc" } })).filter(f => access(user,scope.organisationId,f.id));
    if (query.facilityId && !facilities.some(f => f.id === query.facilityId)) throw Error("FORBIDDEN");
    const managerFacilityIds = facilities.filter(f => access(user,scope.organisationId,f.id,"operations.manage")).map(f => f.id);
    const base: Prisma.TaskWhereInput = { organisationId: scope.organisationId,purpose: FORM_PURPOSE,facilityId: { in: facilities.filter(f => !query.facilityId || f.id === query.facilityId).map(f => f.id) },OR: [{ facilityId: { in: managerFacilityIds } },{ createdById: scope.userId }] };
    const staff = await tx.user.findMany({ where: { organisationId: scope.organisationId,active: true },include: { roleAssignments: { include: { role: true } } },take: 1001 });
    if (staff.length > 1000) throw Error("FORM_LIMIT");
    const meta = { actorId: scope.userId,facilities,managerFacilityIds,reviewers: staff.filter(u => u.id !== scope.userId).map(u => ({ id: u.id,name: u.name,facilityIds: facilities.filter(f => access(u,scope.organisationId,f.id,"operations.manage")).map(f => f.id) })).filter(u => u.facilityIds.length) };
    if (query.id) {
      const task = await tx.task.findFirst({ where: { ...base,id: query.id },select: { ...summarySelect,operationalForm: true } });
      if (!task) throw Error("NOT_FOUND");
      return { ...meta,tasks: undefined,nextCursor: undefined,task: { ...task,operationalForm: formRecordSchema.parse(task.operationalForm) } };
    }
    const where = { ...base,status: query.closed ? { in: ["COMPLETED","CANCELLED"] as ("COMPLETED"|"CANCELLED")[] } : { notIn: ["COMPLETED","CANCELLED"] as ("COMPLETED"|"CANCELLED")[] } };
    if (query.cursor && !await tx.task.count({ where: { ...where,id: query.cursor } })) throw Error("CONFLICT");
    const tasks = await tx.task.findMany({ where,select: summarySelect,orderBy: [{ createdAt: "desc" },{ id: "asc" }],...(query.cursor ? { cursor: { id: query.cursor },skip: 1 } : {}),take: 51 });
    return { ...meta,task: undefined,tasks: tasks.slice(0,50),nextCursor: tasks.length > 50 ? tasks[49].id : null };
  }, { isolationLevel: "RepeatableRead",timeout: 30000 });
}
