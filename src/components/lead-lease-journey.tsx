"use client";

import { FileCheck2, KeyRound, UserRound, Warehouse } from "lucide-react";
import { MoveInProgressNav } from "./move-in-progress-nav";

export type JourneyBooking = {
  id: string; status: string; journey: string; quotedRate: number;
  convertedTenancyId: string | null; unit: { number: string };
  publicLease?: { id: string; status: string; signedAt: string | null; signedPdfSha256: string | null } | null;
  convertedTenancy?: { status: string; accountId: string; documents: { id: string; signedAt: string | null; status: string }[] } | null;
};

export function LeadLeaseJourney({ bookings, customerId, step, setStep, bookingId, setBookingId, canReserve, busy, reserving, onReserve }: {
  bookings: JourneyBooking[]; customerId?: string; step: number; setStep: (step: number) => void;
  bookingId: string; setBookingId: (id: string) => void; canReserve: boolean; busy: boolean;
  reserving: boolean; onReserve: () => void;
}) {
  const live = bookings.filter(b => ["ACTIVE", "CONVERTED"].includes(b.status));
  const booking = live.find(b => b.id === bookingId) ?? (live.length === 1 ? live[0] : undefined);
  const publicSigned = Boolean(booking?.publicLease?.status === "SIGNED" && booking.publicLease.signedAt && booking.publicLease.signedPdfSha256);
  const staffSigned = Boolean(booking?.convertedTenancy?.documents.some(d => d.status === "SIGNED" && d.signedAt));
  const signed = publicSigned || staffSigned;
  const active = Boolean(booking?.status === "CONVERTED" && ["ACTIVE", "NOTICE_GIVEN"].includes(booking.convertedTenancy?.status ?? ""));
  const moveIn = booking ? `/operations/move-in?reservation=${encodeURIComponent(booking.id)}` : "";
  const account = booking?.convertedTenancy ? `/operations/accounts?accountId=${encodeURIComponent(booking.convertedTenancy.accountId)}` : "";
  return <section className="lead-lease-journey" aria-label="Lead to lease workflow">
    <MoveInProgressNav label="Lead to lease progress" steps={[
      {label:"Customer & enquiry",icon:UserRound,status:customerId ? "Customer linked" : "Customer needed",complete:Boolean(customerId),current:step===1,onClick:busy?undefined:()=>setStep(1)},
      {label:"Choose unit",icon:Warehouse,status:booking ? `Unit ${booking.unit.number}` : live.length>1 ? "Choose a booking" : "Reserve storage space",complete:Boolean(booking),current:step===2,onClick:customerId&&!busy?()=>setStep(2):undefined},
      {label:"Lease agreement",icon:FileCheck2,status:signed?"Signed":booking?"Review & send":"Unit needed",complete:signed,current:step===3,onClick:booking&&!busy?()=>setStep(3):undefined},
      {label:"Move in",icon:KeyRound,status:active?"Active tenancy":signed?"Complete move-in checks":"Signature needed",complete:active,current:step===4,onClick:booking&&!busy?()=>setStep(4):undefined},
    ]}/>
    {live.length>1 && step>1 && <label>Booking to continue<select aria-label="Booking to continue" value={booking?.id ?? ""} disabled={busy} onChange={e=>setBookingId(e.target.value)}><option value="">Choose the correct booking</option>{live.map(b=><option key={b.id} value={b.id}>Unit {b.unit.number} · {b.status}</option>)}</select></label>}
    {step===1 && <div className="journey-stage-heading"><p className="eyebrow">STEP 1 OF 4</p><h3>Confirm the customer and enquiry</h3><p>Check contact details, storage requirements and the next follow-up. Save changes before choosing a unit.</p>{customerId && <a href={`/tenants?customer=${encodeURIComponent(customerId)}`}>Review customer details</a>}</div>}
    {step===2 && <div className="journey-stage-heading"><p className="eyebrow">STEP 2 OF 4</p><h3>Choose and reserve storage space</h3><p>Keep the unit, quoted rent and move-in date linked to this enquiry.</p>{booking ? <><p><strong>Unit {booking.unit.number}</strong> · R {booking.quotedRate.toLocaleString("en-ZA")} / month · {booking.status=== "ACTIVE" ? "Reserved" : "Linked to tenancy"}</p><button type="button" className="button button-primary" onClick={()=>setStep(3)} disabled={busy}>Continue to lease agreement</button></> : live.length ? <p>Select the booking above to continue.</p> : reserving ? null : canReserve ? <button type="button" className="button button-primary" onClick={onReserve} disabled={busy}>Choose an available unit</button> : <p>An authorised reservation manager must reserve a unit for this enquiry.</p>}</div>}
    {step===3 && booking && booking.journey !== "RENTAL" && <div className="journey-stage-heading"><h3>Viewing enquiry needs a rental booking</h3><p>Confirm the customer’s rental intention and arrange a rental booking before sending a lease or handing over keys.</p><a className="button button-secondary" href={`/reservations?customer=${encodeURIComponent(customerId ?? "")}`}>Review customer reservations</a></div>}
    {step===3 && booking?.journey === "RENTAL" && <div className="journey-stage-heading"><p className="eyebrow">STEP 3 OF 4</p><h3>{signed ? "Lease agreement signed" : "Review and send the lease agreement"}</h3><p>Unit {booking.unit.number}. {signed ? "Use the agreement already on file and continue with payment and move-in checks." : "Confirm the dates, rent and payment method before sending the agreement for signature."}</p>{publicSigned && <a className="button button-secondary" href={`/api/v1/public-leases/${encodeURIComponent(booking.publicLease!.id)}/signed-pdf`}>View signed agreement</a>}{!signed && <a className="button button-primary" href={account || moveIn}>{account ? "Open pending lease & account" : "Continue to agreement details"}</a>}{signed && <button type="button" className="button button-primary" onClick={()=>setStep(4)}>Continue to move-in checks</button>}<p className="leads-caption">Signing status comes from saved documents. A unit hold does not mean the agreement is signed.</p></div>}
    {step===4 && booking && <div className="journey-stage-heading"><p className="eyebrow">STEP 4 OF 4</p><h3>{active ? "Unit and tenancy active" : "Complete the move-in checks"}</h3><p>{active ? "Review this unit’s account and saved documents. Physical access must be verified separately." : signed ? "Continue with this booking’s payment, ID, access photo and key-handover checks." : "The agreement still needs signature. Review its status before proceeding to move-in."}</p><a className="button button-primary" href={account || moveIn}>{account ? "Open this unit’s account" : signed ? "Continue in Move In" : "Review agreement status"}</a>{account && publicSigned && <a className="button button-secondary" href={moveIn}>View booking handover checks</a>}<p className="leads-caption">Payment, key handover and physical access are separate checks.</p></div>}
    {step>1 && <button type="button" className="text-button" disabled={busy} onClick={()=>setStep(step-1)}>Back to step {step-1}</button>}
  </section>;
}
