import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { currentRoleAccess } from "@/lib/current-role-access";
import { facilityWhere, requireFacility, type RequestScope } from "@/lib/scope";
import { reservationReadiness } from "@/lib/reservation-move-in";
import { arrivalChangeSchema, arrivalQuerySchema } from "@/lib/staff-attention-policy";

type Client = Prisma.TransactionClient;
const staffSelect = { id: true, name: true, active: true } as const;
const sourceInclude = { customer: { select: { firstName: true, lastName: true, companyName: true } }, facility: { select: { name: true } }, unit: { select: { number: true } }, arrivalHandover: { include: { owner: { select: staffSelect }, cover: { select: staffSelect } } } };

async function arrivalSource(scope: RequestScope, reservationId: string, tx: Client = db) {
  const source = await tx.reservation.findFirst({ where: { id: reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId }, status: "ACTIVE", journey: "RENTAL", convertedTenancyId: null }, include: sourceInclude });
  if (!source || !source.intendedMoveIn) throw new Error("FORBIDDEN");
  if (source.arrivalHandover && (source.arrivalHandover.organisationId !== scope.organisationId || source.arrivalHandover.facilityId !== source.facilityId)) throw new Error("FORBIDDEN");
  const { view } = await reservationReadiness(tx, scope, source.id);
  const readiness = { signed: view.signed, paymentVerified: view.paymentVerified, testPayment: view.testPayment, readyNow: view.ready, blockers: view.blockers };
  const sourceHash = createHash("sha256").update(JSON.stringify([source.id, source.facilityId, source.customerId, source.unitId, source.intendedMoveIn.toISOString(), readiness])).digest("hex");
  return { source, readiness, sourceHash };
}

async function eligible(tx: Client, scope: RequestScope, id: string, facilityId: string) {
  const user = await tx.user.findFirst({ where: { id, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user || !currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), "operations.view", facilityId).allowed) throw new Error("FORBIDDEN");
}

export async function staffArrivals(scope: RequestScope, input: unknown) {
  const query = arrivalQuerySchema.parse(input);
  if (query.facilityId) await requireFacility(scope, query.facilityId);
  const facility = { ...facilityWhere(scope), ...(query.facilityId ? { id: query.facilityId } : {}) };
  const from = new Date(`${query.from}T00:00:00+02:00`), to = new Date(new Date(`${query.to}T00:00:00+02:00`).getTime() + 86400000);
  const where = { facility, customer: { organisationId: scope.organisationId }, status: "ACTIVE" as const, journey: "RENTAL" as const, convertedTenancyId: null, intendedMoveIn: { gte: from, lt: to } };
  if (query.cursor && !await db.reservation.count({ where: { ...where, id: query.cursor } })) throw new Error("CONFLICT");
  const [records, facilities, users, undated] = await Promise.all([
    db.reservation.findMany({ where, select: { id: true }, orderBy: [{ intendedMoveIn: "asc" }, { id: "asc" }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 26 }),
    db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } }, orderBy: { name: "asc" } }),
    db.reservation.count({ where: { facility, customer: { organisationId: scope.organisationId }, status: "ACTIVE", journey: "RENTAL", convertedTenancyId: null, intendedMoveIn: null } }),
  ]);
  const staff = users.flatMap(u => { const facilityIds = facilities.filter(f => currentRoleAccess(u.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), "operations.view", f.id).allowed).map(f => f.id); return facilityIds.length ? [{ id: u.id, name: u.name, facilityIds }] : []; });
  // Bounded page. Use existing complete source gates; a failed readiness read must not become a ready flag.
  const rows = await Promise.all(records.slice(0, 25).map(async r => {
    const { source, readiness, sourceHash } = await arrivalSource(scope, r.id);
    const handover = source.arrivalHandover;
    return { id: source.id, customerId: source.customerId, customer: source.customer.companyName || [source.customer.firstName, source.customer.lastName].filter(Boolean).join(" ") || "Customer", facilityId: source.facilityId, facility: source.facility.name, unit: source.unit.number, intendedMoveIn: source.intendedMoveIn!.toISOString(), readiness, sourceHash,
      handover: handover ? { id: handover.id, revision: handover.revision, notes: handover.notes, owner: { id: handover.owner.id, name: handover.owner.name }, cover: handover.cover ? { id: handover.cover.id, name: handover.cover.name } : null, coverAvailable: !!handover.cover && staff.some(s => s.id === handover.coverId && s.facilityIds.includes(source.facilityId)), sourceCurrent: handover.sourceHash === sourceHash, coverAcknowledgedAt: handover.coverAcknowledgedAt?.toISOString() ?? null } : null };
  }));
  return { rows, facilities, staff, undated, nextCursor: records.length > 25 ? records[24].id : null, userId: scope.userId };
}

export async function changeArrivalHandover(scope: RequestScope, reservationId: string, input: unknown) {
  const data = arrivalChangeSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`arrival-handover:${scope.organisationId}:${reservationId}`}, 0))`;
    const { source, sourceHash } = await arrivalSource(scope, reservationId, tx);
    if (sourceHash !== data.sourceHash) throw new Error("CONFLICT");
    const before = source.arrivalHandover;
    if (data.action === "ACKNOWLEDGE") {
      if (!before || before.coverId !== scope.userId) throw new Error("FORBIDDEN");
      await eligible(tx, scope, scope.userId, source.facilityId);
      if (before.revision !== data.expectedRevision) throw new Error("CONFLICT");
      if (before.coverAcknowledgedAt && before.sourceHash === sourceHash) return before;
      const saved = await tx.arrivalHandover.update({ where: { id: before.id }, data: { sourceHash, revision: { increment: 1 }, coverAcknowledgedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: source.facilityId, actorId: scope.userId, action: "arrival_handover.acknowledged", entityType: "ArrivalHandover", entityId: saved.id, before: { revision: before.revision }, after: { revision: saved.revision, sourceHash } } });
      return saved;
    }
    await eligible(tx, scope, data.ownerId, source.facilityId);
    if (data.coverId) await eligible(tx, scope, data.coverId, source.facilityId);
    if (before ? before.revision !== data.expectedRevision : data.expectedRevision !== null) throw new Error("CONFLICT");
    const fields = { ownerId: data.ownerId, coverId: data.coverId, notes: data.notes, sourceHash, coverAcknowledgedAt: null };
    const saved = before ? await tx.arrivalHandover.update({ where: { id: before.id }, data: { ...fields, revision: { increment: 1 } } }) : await tx.arrivalHandover.create({ data: { ...fields, organisationId: scope.organisationId, facilityId: source.facilityId, reservationId } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: source.facilityId, actorId: scope.userId, action: "arrival_handover.assigned", entityType: "ArrivalHandover", entityId: saved.id, before: before ? { revision: before.revision } : undefined, after: { revision: saved.revision, sourceHash, ownerId: saved.ownerId, coverId: saved.coverId, notes: saved.notes } } });
    return saved;
  });
}
