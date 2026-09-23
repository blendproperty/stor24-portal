import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { facilityFloorKeys, floorIsOperational, floorKey, unitIsOperational, floorMapSelection } from "@/lib/floor-availability";

/** All allocation paths take the same facility lock as the floor toggle.
 * Re-read after acquiring it: stale screens cannot allocate a closed floor.
 * Lock facility before unit/reservation rows to keep lock ordering consistent.
 */
export async function requireOperationalUnit(tx: Prisma.TransactionClient, facilityId: string, unitId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${facilityId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id" = ${unitId} AND "facilityId" = ${facilityId} FOR UPDATE`;
  const unit = await tx.unit.findFirst({ where: { id: unitId, facilityId }, include: { mapElements: floorMapSelection, facility: { select: { closedFloors: true } } } });
  if (!unit) throw new Error("UNIT_UNAVAILABLE");
  if (!unitIsOperational(unit, unit.facility.closedFloors)) throw new Error("FLOOR_NOT_OPERATIONAL");
}

export async function setFloorOperational(scope: RequestScope, input: { facilityId: string; floor: string; operational: boolean; expectedOperational: boolean }) {
  return db.$transaction(async tx => {
    const allowed = await tx.facility.findFirst({ where: { id: input.facilityId, ...facilityWhere(scope) }, select: { id: true } });
    if (!allowed) throw new Error("FORBIDDEN");
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${allowed.id} FOR UPDATE`;
    const facility = await tx.facility.findUniqueOrThrow({ where: { id: allowed.id }, include: { units: { select: { floor: true } }, maps: { select: { name: true } } } });
    const floor = floorKey(input.floor);
    if (!floor || !facilityFloorKeys(facility).includes(floor)) throw new Error("NOT_FOUND");
    const operational = floorIsOperational(floor, facility.closedFloors);
    if (operational !== input.expectedOperational) throw new Error("FLOOR_STATE_CHANGED");
    if (operational === input.operational) return { closedFloors: facility.closedFloors };
    const closedFloors = [...new Set(facility.closedFloors.map(floorKey))].filter(key => key !== floor);
    if (!input.operational) closedFloors.push(floor);
    await tx.facility.update({ where: { id: facility.id }, data: { closedFloors } });
    await tx.auditEvent.create({ data: {
      organisationId: scope.organisationId, facilityId: facility.id, actorId: scope.userId,
      action: "facility.floor_availability_changed", entityType: "Facility", entityId: facility.id,
      before: { floor, operational }, after: { floor, operational: input.operational },
    } });
    return { closedFloors };
  });
}
