import type { Prisma } from "@/generated/prisma/client";

const protectedOccupancies = ["PENDING", "ACTIVE", "NOTICE_GIVEN", "TRANSFERRING"] as const;
export async function protectUnitStructure(tx: Prisma.TransactionClient, facilityId: string, id: string, patch: Record<string, unknown>) {
  const unit = await tx.unit.findFirst({ where: { id, facilityId } });
  if (!unit) throw new Error("NOT_FOUND");
  const structural = ["unitTypeId", "floor", "zone", "businessAttributesOverride", "useTypesOverride"] as const;
  const changed = structural.some(key => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(unit[key]));
  const statusChanged = "status" in patch && patch.status !== unit.status;
  if (!changed && !statusChanged) return;
  const [occupancies, reservations] = await Promise.all([
    tx.occupancy.count({ where: { unitId: id, status: { in: [...protectedOccupancies] } } }),
    tx.reservation.count({ where: { unitId: id, status: "ACTIVE" } }),
  ]);
  if (occupancies || reservations) throw new Error("UNIT_STRUCTURE_PROTECTED");
}

export async function protectUnitTypeStructure(tx: Prisma.TransactionClient, facilityId: string, id: string, patch: Record<string, unknown>) {
  const type = await tx.unitType.findFirst({ where: { id, facilityId } });
  if (!type) throw new Error("NOT_FOUND");
  const dimensions = ["widthMetres", "lengthMetres", "areaSqMetres"] as const;
  if (!dimensions.some(key => key in patch && Number(patch[key]) !== Number(type[key]))) return;
  const units = { facilityId, unitTypeId: id };
  const [occupancies, reservations] = await Promise.all([
    tx.occupancy.count({ where: { unit: units, status: { in: [...protectedOccupancies] } } }),
    tx.reservation.count({ where: { unit: units, status: "ACTIVE" } }),
  ]);
  if (occupancies || reservations) throw new Error("UNIT_STRUCTURE_PROTECTED");
}
