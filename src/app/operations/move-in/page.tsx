import { TrainingEntry } from "@/components/move-in-training";
import { getMoveInProgress } from "@/lib/move-in-progress";
import { requireSession } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { moveInAction } from "@/app/actions/leasing";
import { MoveInWorkspace } from "@/components/move-in-workspace";
import { listLeasing } from "@/lib/leasing-service";
import { requirePermissionScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { getReservationMoveInReadiness } from "@/lib/reservation-move-in";
import { legacyHandoverReadiness } from "@/lib/legacy-handover";
import { LegacyHandoverList } from "@/components/legacy-handover-list";

export const metadata = { title: "Move in" };

export default async function MoveInPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const { reservation: initialReservationId } = await searchParams;
  const scope = await requirePermissionScope("move_in.create");
  const data = await listLeasing(scope);
  const auth = await requireSession();
  const legacy = await Promise.all(data.tenancies.filter(t=>["DRAFT","ACTIVE","NOTICE_GIVEN"].includes(t.status) && t.documents.some(d=>d.status==="SIGNED")).map(async t=>({
    id:t.id,accountId:t.accountId,label:`${t.facility.name} · ${t.occupancies[0]?.unit.number ?? "Unit needs review"} · ${t.customer.companyName || t.customer.firstName || "Customer"}`,
    possibleLeads:data.reservations.some(r=>r.convertedTenancyId===t.id)?[]:data.leads.filter(l=>l.facilityId===t.facilityId&&l.customerId===t.customerId&&l.stage!=="LOST"&&!data.reservations.some(r=>r.leadId===l.id)).map(l=>({id:l.id,label:`${l.source} · ${southAfricaDateKey(l.createdAt)} · ${l.stage.replaceAll("_"," ")}`})),
    canReviewPhoto:auth.role==="Organisation owner" || auth.user.roleAssignments.some(a=>(!a.facilityId || a.facilityId===t.facilityId)&&hasPermission(a.role.permissions,"access.manage")),
    ...(await legacyHandoverReadiness(scope,t.id)),
  })));
  const reservations = await Promise.all(data.reservations.filter(reservation => reservation.status === "ACTIVE" || (reservation.id === initialReservationId && reservation.status === "CONVERTED")).map(async reservation => ({
    progress: reservation.publicLease?.status === "SIGNED" ? await getMoveInProgress(scope, reservation.id) : undefined,
    canReviewPhoto: auth.role === "Organisation owner" || auth.user.roleAssignments.some(a => (!a.facilityId || a.facilityId === reservation.facilityId) && hasPermission(a.role.permissions, "access.view")),
    canReviewIdentity: auth.role === "Organisation owner" || auth.user.roleAssignments.some(a => (!a.facilityId || a.facilityId === reservation.facilityId) && hasPermission(a.role.permissions, "identity.review")),
    canRecordPayment: auth.role === "Organisation owner" || auth.user.roleAssignments.some(a => (!a.facilityId || a.facilityId === reservation.facilityId) && hasPermission(a.role.permissions, "payments.manage")),
    leadId: reservation.leadId, id: reservation.id, facilityId: reservation.facilityId, customerId: reservation.customerId, unitId: reservation.unitId,
    label: `${reservation.unit.number} · ${reservation.customer.companyName || reservation.customer.firstName || "Customer"}`,
    paymentMethod: reservation.paymentMethod, intendedMoveIn: reservation.intendedMoveIn ? southAfricaDateKey(reservation.intendedMoveIn) : null,
    quotedRate: Number(reservation.quotedRate),
    legacyHandover: reservation.status === "CONVERTED" && reservation.publicLease?.status !== "SIGNED",
    legacyAccountId: data.tenancies.find(t=>t.id===reservation.convertedTenancyId)?.accountId ?? null,
    legacySigned: Boolean(data.tenancies.find(t=>t.id===reservation.convertedTenancyId)?.documents.some(d=>d.status==="SIGNED")),
    readiness: reservation.publicLease?.status === "SIGNED" ? await getReservationMoveInReadiness(scope, reservation.id) : null,
  })));
  return <><TrainingEntry/><MoveInWorkspace action={moveInAction}
    initialReservationId={initialReservationId}
    facilities={data.facilities.map(({ id, name }) => ({ id, name }))}
    units={data.facilities.flatMap((facility) => facility.units.filter(unit => unit.floorOperational).map((unit) => ({ id: unit.id, facilityId: unit.facilityId, number: unit.number, floor: unit.floor ?? "", zone: unit.zone ?? "", status: unit.status, monthlyRate: Number(unit.monthlyRate), typeName: unit.unitType.name, width: unit.unitType.widthMetres === null ? null : Number(unit.unitType.widthMetres), length: unit.unitType.lengthMetres === null ? null : Number(unit.unitType.lengthMetres), area: unit.unitType.areaSqMetres === null ? null : Number(unit.unitType.areaSqMetres), features: unit.unitType.features })))}
    customers={data.customers.map((customer) => ({ id: customer.id, name: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer", email: customer.email }))}
    reservations={reservations}/><LegacyHandoverList items={legacy.filter(t=>!t.handedOver || (t.canReviewPhoto && t.photo && ["WAITING_REVIEW","APPROVED","PENDING_PROVIDER"].includes(t.photo.status)))}/></>;
}
