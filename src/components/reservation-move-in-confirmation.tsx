"use client";

import { ReservationPaymentForm } from "./reservation-payment-form";
import { useState } from "react";
import type { ReservationMoveInReadiness } from "@/lib/reservation-move-in";
import { confirmReservationMoveInAction } from "@/app/actions/leasing";

export function ReservationMoveInConfirmation({ reservationId, customerName, unitNumber, readiness, canRecordPayment = false, onBack }: {
  canRecordPayment?: boolean; reservationId: string; customerName: string; unitNumber: string; readiness: ReservationMoveInReadiness; onBack: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (amount: number) => `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
  return <section className="panel panel-spacious">
    <h2>{readiness.ready ? "Ready for key collection" : "Move-in checks"}</h2>
    <p>{customerName} · Unit {unitNumber}</p>
    <div className="move-in-form">
      <section><h3>Agreement signed</h3><p>The existing signed agreement is saved. No new signature is required.</p>{readiness.leaseId && <a href={`/api/v1/public-leases/${readiness.leaseId}/signed-pdf`}>View signed agreement</a>}</section>
      <section><h3>{readiness.paymentVerified ? "Payment verified" : "Payment confirmation needed"}</h3><p>{money(readiness.paidAmount)} cleared towards the {money(readiness.requiredAmount)} booking amount.</p></section>
      <section><h3>Agreed move-in date</h3><p>{readiness.startDate ?? "Not recorded"}</p></section>
      <section><h3>Key handover</h3><p>Check the customer identity and unit, then record the key handover at the guard house. Facial access is managed separately.</p></section>
    </div>
    {readiness.mandateStatus && <p><strong>Debit-order mandate: {readiness.mandateStatus.replaceAll("_", " ")}</strong>. A signed mandate is not a payment. Collections are not enabled; the first payment must be verified separately.</p>}
    {canRecordPayment && !readiness.paymentVerified && <ReservationPaymentForm reservationId={reservationId} />}
    {readiness.blockers.length > 0 && <div role="status"><ul>{readiness.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul><p>The signed agreement remains on file while these checks are resolved.</p></div>}
    <form action={async data => {
      setBusy(true); setError("");
      try { const result = await confirmReservationMoveInAction(data); if (result?.error) setError(result.error); }
      finally { setBusy(false); }
    }}>
      <input type="hidden" name="reservationId" value={reservationId} />
      {readiness.ready && <label><input type="checkbox" name="handoverConfirmed" required disabled={busy} /> I have checked the customer identity and am handing over the keys for this unit.</label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="button button-secondary" onClick={() => window.location.reload()} disabled={busy}>Refresh checks</button>
        <button className="button button-primary" disabled={!readiness.ready || busy}>{busy ? "Recording handover…" : "Confirm move-in / key handover"}</button>
      </div>
    </form>
  </section>;
}
