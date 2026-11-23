import { requirePermissionScope } from "@/lib/scope";
import { listLeasing } from "@/lib/leasing-service";
import { MultiUnitMoveIn } from "@/components/multi-unit-move-in";

export default async function MultiUnitMoveInPage() {
  const scope = await requirePermissionScope("move_in.create");
  const data = await listLeasing(scope);
  return <MultiUnitMoveIn
    facilities={data.facilities.map(f => ({ id: f.id, name: f.name }))}
    units={data.facilities.flatMap(f => f.units.filter(u => u.floorOperational && u.status === "AVAILABLE").map(u => ({ id: u.id, facilityId: f.id, number: u.number, rate: Number(u.monthlyRate), type: u.unitType.name })))}
    customers={data.customers.map(c => ({ id: c.id, name: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed customer", email: c.email }))} />;
}
