import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope, type RequestScope } from "@/lib/scope";
import { eligibleWalkInReservation, walkInPhotoReservation, walkInPhotoStatus } from "@/lib/walk-in-photo";
import { WalkInPhotoPreparation } from "@/components/walk-in-photo-preparation";
import { PageHeader } from "@/components/page-header";
import { WalkInStarter } from "@/components/walk-in-starter";

export const metadata = { title: "Walk-in tablet" };
export default async function WalkInPage() {
  const scope = await requirePermissionScope("reservations.manage");
  let photoScope: RequestScope | null = null;
  try { photoScope = await requirePermissionScope("move_in.create"); }
  catch (error) { if (!(error instanceof Error) || error.message !== "FORBIDDEN") throw error; }
  const facilities = await db.facility.findMany({
    where: { AND: [facilityWhere(scope), { active: true, publicBookingEnabled: true, publicSlug: { not: null } }] },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  const visits = await db.walkInVisit.findMany({
    where: { organisationId: scope.organisationId, facilityId: { in: facilities.map(facility => facility.id) }, reservationId: { not: null } },
    orderBy: { createdAt: "desc" }, take: 20,
    include: {
      facility: { select: { name: true } },
      reservation: { select: {
        ...walkInPhotoReservation, id: true, publicReference: true, leadId: true, unit: { select: { number: true } },
        customer: { select: { ...walkInPhotoReservation.customer.select, firstName: true, lastName: true } },
      } },
    },
  });
  const rows = await Promise.all(visits.map(async visit => {
    const reservation = visit.reservation;
    if (!reservation) return null;
    const photoPermitted = Boolean(photoScope && (photoScope.unrestrictedFacilities || photoScope.facilityIds.includes(visit.facilityId)));
    const active = visit.status !== "CLOSED" && visit.expiresAt > new Date();
    const photoStatus = photoPermitted && active ? await walkInPhotoStatus(visit) : null;
    const photo = reservation.customer.hikCentralFaceCapture;
    const canPrepare = photoPermitted && active && !photoStatus && visit.customerTokenHash &&
      eligibleWalkInReservation(reservation) && (!photo || ["EXPIRED", "REJECTED", "WITHDRAWN", "PROVIDER_REMOVED"].includes(photo.status));
    const customerName = [reservation.customer.firstName, reservation.customer.lastName].filter(Boolean).join(" ");
    return <div key={visit.id}>
      <strong>{reservation.publicReference} · Unit {reservation.unit.number}</strong>
      <p>{visit.facility.name} · {reservation.status}</p>
      {photoPermitted && photo?.facilityId === visit.facilityId && <p>Access photo: {photo.status.replaceAll("_", " ").toLowerCase()}.</p>}
      {photoStatus === "ready" && <p>Access photo is ready on the tablet.</p>}
      {photoStatus === "waiting-for-signature" && <p>Access photo will open after signing.</p>}
      {canPrepare && <WalkInPhotoPreparation visitId={visit.id} facilityId={visit.facilityId} customerName={customerName} />}
      <div className="form-actions">
        <a className="button button-secondary" href={`/operations/move-in?reservation=${encodeURIComponent(reservation.id)}`}>Continue Move in</a>
        {reservation.leadId && <a className="button button-secondary" href={`/leads?lead=${encodeURIComponent(reservation.leadId)}`}>Review enquiry journey</a>}
      </div>
    </div>;
  }));
  return <div className="page-stack">
    <PageHeader eyebrow="Lead to lease" title="Walk-in on tablet" description="The website booking journey, ready for a customer at the counter." />
    <WalkInStarter facilities={facilities} />
    <section className="panel lease-signing-panel">
      <h2>Recent walk-in bookings</h2>
      {rows.length ? rows : <p>Refresh this page once the customer saves their booking details.</p>}
    </section>
  </div>;
}
