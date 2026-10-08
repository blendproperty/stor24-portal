import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";
import { PageHeader } from "@/components/page-header";
import { WalkInStarter } from "@/components/walk-in-starter";
export const metadata = { title: "Walk-in tablet" };
export default async function WalkInPage() {
  const scope = await requirePermissionScope("reservations.create");
  const facilities = await db.facility.findMany({ where: { AND: [facilityWhere(scope), { active: true, publicBookingEnabled: true, publicSlug: { not: null } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const visits = await db.walkInVisit.findMany({ where: { organisationId: scope.organisationId, facilityId: { in: facilities.map(f => f.id) }, reservationId: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, include: { facility: { select: { name: true } }, reservation: { select: { id: true, publicReference: true, status: true, leadId: true, unit: { select: { number: true } } } } } });
  return <div className="page-stack"><PageHeader eyebrow="Lead to lease" title="Walk-in on tablet" description="The website booking journey, ready for a customer at the counter."/><WalkInStarter facilities={facilities}/><section className="panel lease-signing-panel"><h2>Recent walk-in bookings</h2>{visits.length ? visits.map(v => <div key={v.id}><strong>{v.reservation?.publicReference} · Unit {v.reservation?.unit.number}</strong><p>{v.facility.name} · {v.reservation?.status}</p><div className="form-actions"><a className="button button-secondary" href={`/operations/move-in?reservation=${encodeURIComponent(v.reservation!.id)}`}>Continue Move in</a>{v.reservation?.leadId && <a className="button button-secondary" href={`/leads?lead=${encodeURIComponent(v.reservation.leadId)}`}>Review enquiry journey</a>}</div></div>) : <p>Bookings from the tablet will appear here as soon as the customer saves their details.</p>}</section></div>;
}
