import { currentRoleAccess } from "./current-role-access";
import { db } from "./db";
import { facilityWhere, type RequestScope } from "./scope";
import { walkInToken, walkInTokenHash, walkInUsable, WALK_IN_LAUNCH_MS, WALK_IN_VISIT_MS } from "./walk-in-policy";

const include = { facility: { select: { id: true, name: true, publicSlug: true, active: true, publicBookingEnabled: true } }, createdBy: { select: { active: true, roleAssignments: { include: { role: true } } } }, reservation: { select: { publicReference: true } } };
export async function startWalkIn(scope: RequestScope, facilityId: string) {
  const facility = await db.facility.findFirst({ where: { AND: [{ id: facilityId, active: true, publicBookingEnabled: true, publicSlug: { not: null } }, facilityWhere(scope)] } });
  if (!facility) throw new Error("FACILITY_FORBIDDEN");
  const launch = walkInToken(), now = new Date();
  const visit = await db.$transaction(async tx => {
    const visit = await tx.walkInVisit.create({ data: { organisationId: scope.organisationId, facilityId, createdById: scope.userId, launchTokenHash: walkInTokenHash(launch), launchExpiresAt: new Date(now.getTime() + WALK_IN_LAUNCH_MS), expiresAt: new Date(now.getTime() + WALK_IN_VISIT_MS) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "walk_in.started", entityType: "WalkInVisit", entityId: visit.id, after: { expiresAt: visit.expiresAt.toISOString() } } });
    return visit;
  });
  return { id: visit.id, launchUrl: `https://stor24.co.za/walk-in#launch=${launch}`, expiresAt: visit.launchExpiresAt.toISOString(), facilityName: facility.name };
}
export async function redeemWalkIn(launch: string) {
  const hash = walkInTokenHash(launch);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "WalkInVisit" WHERE "launchTokenHash" = ${hash} FOR UPDATE`;
    const visit = await tx.walkInVisit.findUnique({ where: { launchTokenHash: hash }, include });
    if (!walkInUsable(visit) || !visit || !currentRoleAccess(visit.createdBy.roleAssignments, "reservations.manage", visit.facilityId).allowed || visit.redeemedAt || visit.launchExpiresAt <= new Date()) throw new Error("WALK_IN_UNAVAILABLE");
    const token = walkInToken();
    await tx.walkInVisit.update({ where: { id: visit.id }, data: { customerTokenHash: walkInTokenHash(token), redeemedAt: new Date() } });
    return { token, expiresAt: visit.expiresAt.toISOString() };
  });
}
export async function activeWalkIn(token: string) {
  const visit = await db.walkInVisit.findUnique({ where: { customerTokenHash: walkInTokenHash(token) }, include });
  if (!walkInUsable(visit) || !visit || !currentRoleAccess(visit.createdBy.roleAssignments, "reservations.manage", visit.facilityId).allowed) throw new Error("WALK_IN_UNAVAILABLE");
  return visit;
}
export async function walkInView(token: string) {
  const visit = await activeWalkIn(token);
  return { facilitySlug: visit.facility.publicSlug, facilityName: visit.facility.name, expiresAt: visit.expiresAt.toISOString(), reference: visit.reservation?.publicReference ?? null };
}
export async function endWalkIn(token: string) {
  const hash = walkInTokenHash(token);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "WalkInVisit" WHERE "customerTokenHash" = ${hash} FOR UPDATE`;
    const visit = await tx.walkInVisit.findUnique({ where: { customerTokenHash: hash } });
    if (!visit || visit.status === "CLOSED") return;
    await tx.walkInVisit.update({ where: { id: visit.id }, data: { status: "CLOSED", endedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId: visit.organisationId, facilityId: visit.facilityId, actorId: visit.createdById, action: "walk_in.tablet_cleared", entityType: "WalkInVisit", entityId: visit.id, after: { reservationRetained: Boolean(visit.reservationId) } } });
  });
}
