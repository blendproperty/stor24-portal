"use client";
import { useRef, useState } from "react";
import { recordReservationPaymentAction } from "@/app/actions/reservation-payment";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export function ReservationPaymentForm({ reservationId }: { reservationId: string }) {
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <details className="panel panel-spacious"><summary>Record a payment already received</summary>
    <p>For authorised staff: record a verified EFT, cash receipt or approved card-terminal payment against this booking before move-in. This does not charge the customer.</p>
    <p><strong>Do not record sandbox or simulated payments here.</strong> Test payments remain separate and cannot authorise real key handover.</p>
    <form action={async data => {
      if (busy) return;
      setBusy(true); setError("");
      requestId.current ??= crypto.randomUUID(); data.set("requestId", requestId.current);
      try { const result = await recordReservationPaymentAction(data); if (result.error) setError(result.error); else window.location.reload(); }
      catch { setError("Confirmation was interrupted. Retry with the same details; the receipt will not be posted twice."); }
      finally { setBusy(false); }
    }}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="move-in-form">
        <label>Amount received (R)<input type="number" name="amount" min="0.01" max="10000000" step="0.01" required disabled={busy} /></label>
        <label>Payment method<select name="method" disabled={busy}><option value="EFT">EFT</option><option value="CASH">Cash</option><option value="CARD">Card terminal</option></select></label>
        <label>Bank, terminal or cash receipt reference<input name="reference" minLength={3} maxLength={120} required disabled={busy} /></label>
        <label>Date received<input type="date" name="receivedAt" max={southAfricaDateKey(new Date())} required disabled={busy} /></label>
      </div>
      <label><input type="checkbox" name="realPaymentConfirmed" required disabled={busy} /> I have verified that these real funds were received. This is not a test or sandbox payment.</label>
      {error && <p role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? "Recording…" : "Record verified payment"}</button>
    </form>
  </details>;
}
