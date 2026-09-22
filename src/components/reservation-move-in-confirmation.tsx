"use client";

import { ReservationPaymentForm } from "./reservation-payment-form";
import { useState } from "react";
import { FileCheck2, Wallet, CalendarDays, ArrowUpRight, CircleAlert, KeyRound, Check } from "lucide-react";
import type { ReservationMoveInReadiness } from "@/lib/reservation-move-in";
import { confirmReservationMoveInAction } from "@/app/actions/leasing";

export function ReservationMoveInConfirmation({ reservationId, customerName, unitNumber, readiness, canRecordPayment = false, onBack }: {
  canRecordPayment?: boolean; reservationId: string; customerName: string; unitNumber: string; readiness: ReservationMoveInReadiness; onBack: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (amount: number) => `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
  const moveInDate = readiness.startDate ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(`${readiness.startDate}T12:00:00+02:00`)) : "Not recorded";
  return <section className="handover-workspace" aria-label="Booking handover checks">
    <header className="handover-heading">
      <div><p className="handover-eyebrow">BOOKING HANDOVER</p><h2>{readiness.ready ? "Ready for key collection" : "Move-in checks"}</h2><p className="handover-customer">{customerName}<span>Unit {unitNumber}</span></p></div>
      <span className={`handover-status ${readiness.ready ? "is-ready" : "is-pending"}`}>{readiness.ready ? <Check size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}{readiness.ready ? "Ready to move in" : "Action required"}</span>
    </header>
    <div className="handover-checks" data-guide="handover-checks">
      <section className="handover-check" data-guide="handover-agreement"><div className="handover-check-label"><FileCheck2 size={19} aria-hidden="true" /><span>01 · Agreement</span></div><h3>{readiness.signed ? "Agreement signed" : "Agreement needs review"}</h3><p>{readiness.signed ? "Your signed document is saved. No new signature is required." : "Review the agreement before handing over keys."}</p>{readiness.leaseId && readiness.signed && <a className="handover-document" href={`/api/v1/public-leases/${readiness.leaseId}/signed-pdf`}>View signed agreement <ArrowUpRight size={15} aria-hidden="true" /></a>}</section>
      <section className="handover-check"><div className="handover-check-label"><Wallet size={19} aria-hidden="true" /><span>02 · Payment</span></div><h3>{readiness.paymentVerified ? "Payment verified" : "Payment confirmation needed"}</h3><p className="handover-amount">{money(readiness.paidAmount)} <span>verified</span></p><p>of {money(readiness.requiredAmount)} required for this booking</p>{readiness.testPayment && <span className="handover-test-label">Sandbox payment on file</span>}</section>
      <section className="handover-check"><div className="handover-check-label"><CalendarDays size={19} aria-hidden="true" /><span>03 · Move-in date</span></div><h3>{moveInDate}</h3><p>Key collection is available from the agreed start date, once all checks are complete.</p></section>
    </div>
    {readiness.blockers.length > 0 && <aside className="handover-notice" role="status"><CircleAlert size={20} aria-hidden="true" /><div><h3>Before keys can be released</h3><ul>{readiness.blockers.map(blocker => <li key={blocker}>{blocker.replace(/\b\d{4}-\d{2}-\d{2}\b/g, value => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(`${value}T12:00:00+02:00`)))}</li>)}</ul>{readiness.signed && <p>Your signed agreement stays on file.</p>}</div></aside>}
    {readiness.mandateStatus && <div className="handover-mandate"><h3>Debit-order mandate <span>{readiness.mandateStatus.replaceAll("_", " ")}</span></h3><p>A mandate is not a payment. Collections are not enabled; verify the first payment separately.</p></div>}
    {canRecordPayment && !readiness.paymentVerified && <ReservationPaymentForm reservationId={reservationId} />}
    <div className="handover-key-note"><KeyRound size={20} aria-hidden="true" /><div><h3>Key handover at the guard house</h3><p>Check the customer’s identity and unit before recording collection. A reviewed customer photo enters the activation queue when move-in is recorded. Gate access still requires provider confirmation.</p></div></div>
    <form action={async data => {
      setBusy(true); setError("");
      try { const result = await confirmReservationMoveInAction(data); if (result?.error) setError(result.error); }
      finally { setBusy(false); }
    }}>
      <input type="hidden" name="reservationId" value={reservationId} />
      {readiness.ready && <label className="handover-attestation"><input type="checkbox" name="handoverConfirmed" required disabled={busy} /> I have checked the customer identity and am handing over the keys for this unit.</label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="handover-actions" data-guide="handover-actions">
        <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="button button-secondary" onClick={() => window.location.reload()} disabled={busy}>Refresh checks</button>
        <button className="button button-primary" disabled={!readiness.ready || busy}>{busy ? "Recording handover…" : "Confirm move-in / key handover"}</button>
      </div>
    </form>
  </section>;
}
