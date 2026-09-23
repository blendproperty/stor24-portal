import { requireSession } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { moveInAction } from "@/app/actions/leasing";
import { MoveInWorkspace } from "@/components/move-in-workspace";
import { listLeasing } from "@/lib/leasing-service";
import { requireScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { getReservationMoveInReadiness } from "@/lib/reservation-move-in";

export const metadata = { title: "Move in" };

export default async function MoveInPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const { reservation: initialReservationId } = await searchParams;
  const scope = await requireScope();
  const data = await listLeasing(scope);
  const auth = await requireSession();
  const reservations = await Promise.all(data.reservations.filter(reservation => reservation.status === "ACTIVE").map(async reservation => ({
    canReviewIdentity: auth.role === "Organisation owner" || auth.user.roleAssignments.some(a => (!a.facilityId || a.facilityId === reservation.facilityId) && hasPermission(a.role.permissions, "identity.review")),
    canRecordPayment: auth.role === "Organisation owner" || auth.user.roleAssignments.some(a => (!a.facilityId || a.facilityId === reservation.facilityId) && hasPermission(a.role.permissions, "payments.manage")),
    id: reservation.id, facilityId: reservation.facilityId, customerId: reservation.customerId, unitId: reservation.unitId,
    label: `${reservation.unit.number} · ${reservation.customer.companyName || reservation.customer.firstName || "Customer"}`,
    paymentMethod: reservation.paymentMethod, intendedMoveIn: reservation.intendedMoveIn ? southAfricaDateKey(reservation.intendedMoveIn) : null,
    quotedRate: Number(reservation.quotedRate),
    readiness: reservation.publicLease?.status === "SIGNED" ? await getReservationMoveInReadiness(scope, reservation.id) : null,
  })));
  return <MoveInWorkspace action={moveInAction}
    initialReservationId={initialReservationId}
    facilities={data.facilities.map(({ id, name }) => ({ id, name }))}
    units={data.facilities.flatMap((facility) => facility.units.filter(unit => unit.floorOperational).map((unit) => ({ id: unit.id, facilityId: unit.facilityId, number: unit.number, floor: unit.floor ?? "", zone: unit.zone ?? "", status: unit.status, monthlyRate: Number(unit.monthlyRate), typeName: unit.unitType.name, width: unit.unitType.widthMetres === null ? null : Number(unit.unitType.widthMetres), length: unit.unitType.lengthMetres === null ? null : Number(unit.unitType.lengthMetres), area: unit.unitType.areaSqMetres === null ? null : Number(unit.unitType.areaSqMetres), features: unit.unitType.features })))}
    customers={data.customers.map((customer) => ({ id: customer.id, name: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer", email: customer.email }))}
    reservations={reservations}/>
}
