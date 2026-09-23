"use client";
import { useRef, useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { recordReservationPaymentAction } from "@/app/actions/reservation-payment";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export function ReservationPaymentForm({ reservationId }: { reservationId: string }) {
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <details className="handover-receipt"><summary><span className="handover-receipt-icon"><Wallet size={20} aria-hidden="true" /></span><span><strong>Record a payment already received</strong><small>Verified EFT, cash or card-terminal receipts</small></span><ChevronDown className="handover-chevron" size={19} aria-hidden="true" /></summary>
    <div className="handover-receipt-body"><p>Use this only after confirming the funds were received. Recording a receipt does not charge the customer.</p>
    <p className="handover-receipt-warning">Real payments only. Sandbox and simulated transactions cannot authorise key collection.</p>
    <form action={async data => {
      if (busy) return;
      setBusy(true); setError("");
      requestId.current ??= crypto.randomUUID(); data.set("requestId", requestId.current);
      try { const result = await recordReservationPaymentAction(data); if (result.error) setError(result.error); else window.location.assign(`/operations/move-in?reservation=${encodeURIComponent(reservationId)}#move-in-payment`); }
      catch { setError("Confirmation was interrupted. Retry with the same details; the receipt will not be posted twice."); }
      finally { setBusy(false); }
    }}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="handover-receipt-fields">
        <label>Amount received (R)<input type="number" name="amount" min="0.01" max="10000000" step="0.01" required disabled={busy} /></label>
        <label>Payment method<select name="method" disabled={busy}><option value="EFT">EFT</option><option value="CASH">Cash</option><option value="CARD">Card terminal</option></select></label>
        <label>Bank, terminal or cash receipt reference<input name="reference" minLength={3} maxLength={120} required disabled={busy} /></label>
        <label>Date received<input type="date" name="receivedAt" max={southAfricaDateKey(new Date())} required disabled={busy} /></label>
      </div>
      <label className="handover-attestation"><input type="checkbox" name="realPaymentConfirmed" required disabled={busy} /> I have verified that these real funds were received. This is not a test or sandbox payment.</label>
      {error && <p role="alert">{error}</p>}
      <div className="handover-receipt-submit"><button className="button button-primary" disabled={busy}>{busy ? "Recording…" : "Record verified payment"}</button></div>
    </form></div>
  </details>;
}
