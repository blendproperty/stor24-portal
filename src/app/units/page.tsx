import { UnitInventoryWorkspace } from "@/components/unit-inventory-workspace";
import { listLeasing } from "@/lib/leasing-service";
import { requireScope } from "@/lib/scope";

export const metadata = { title: "Units & rates" };

export default async function UnitsPage() {
  const { facilities, tenancies } = await listLeasing(await requireScope());
  const accountByUnitId = new Map(tenancies.flatMap((tenancy) => tenancy.occupancies.filter((occupancy) => ["ACTIVE", "NOTICE_GIVEN"].includes(occupancy.status)).map((occupancy) => [occupancy.unitId, tenancy.accountId] as const)));
  return <UnitInventoryWorkspace initialFacilities={facilities.map((facility) => ({ id: facility.id, name: facility.name, code: facility.code, unitTypes: facility.unitTypes.map((type) => ({ ...type, widthMetres: type.widthMetres?.toString() ?? null, lengthMetres: type.lengthMetres?.toString() ?? null, areaSqMetres: type.areaSqMetres?.toString() ?? null })), units: facility.units.map((unit) => ({ ...unit, accountId: accountByUnitId.get(unit.id) ?? null, monthlyRate: unit.monthlyRate.toString(), taxRate: unit.taxRate.toString(), unitType: { ...unit.unitType, widthMetres: unit.unitType.widthMetres?.toString() ?? null, lengthMetres: unit.unitType.lengthMetres?.toString() ?? null, areaSqMetres: unit.unitType.areaSqMetres?.toString() ?? null } })) }))}/>;
}
