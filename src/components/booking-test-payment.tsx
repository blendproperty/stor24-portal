"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { bookingTestPaymentSnapshotSchema, type BookingTestPaymentSnapshot } from "@/lib/booking-test-payment-contract";

const endpoint = "/api/v1/move-in-training/payment";
export function BookingTestPayment({ reservationId, requiredAmount }: { reservationId: string; requiredAmount: number }) {
  const [data, setData] = useState<BookingTestPaymentSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const requestLock = useRef(false);
  const read = useCallback(async () => {
    if (requestLock.current) return;
    requestLock.current = true; setBusy(true);
    try {
      const response = await fetch(`${endpoint}?reservation=${encodeURIComponent(reservationId)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.status === 401 || response.status === 403) { setData(null); setError(""); return; }
      const parsed = bookingTestPaymentSnapshotSchema.safeParse((await response.json()).data);
      if (!response.ok || !parsed.success || parsed.data.reservationId !== reservationId) throw new Error();
      setData(parsed.data); setError("");
      setUncertain(false); // A fresh read permits a deliberate retry; the server deduplicates the booking/session.
    } catch { setData(null); setError("Test-payment status could not be loaded. Check status before continuing."); }
    finally { requestLock.current = false; setBusy(false); }
  }, [reservationId]);
  useEffect(() => { const timer = setTimeout(() => void read(), 0); return () => clearTimeout(timer); }, [read]);
  return <section className="handover-receipt" aria-label="Booking test payment" style={{ padding: 16 }}>
    <h3>Test payment on this booking</h3>
    <p><strong>TEST — no funds received.</strong> This saves a training record only. It does not change the statement, account balance, real payment checks or key-release requirements.</p>
    {data && !data.enabled && <p>The owner must enable Manager training above. Then check status here.</p>}
    {data?.receipt && <p role="status"><strong>Test payment recorded: R {data.receipt.amount.toFixed(2)}</strong><br />Training record saved. Real payment confirmation is still required.</p>}
    {data?.enabled && !data.receipt && <form onSubmit={async event => {
      event.preventDefault(); if (requestLock.current || uncertain) return;
      const amount = Number(new FormData(event.currentTarget).get("testAmount"));
      requestLock.current = true; setBusy(true); setError("");
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ reservationId, generation: data.generation, amount, testConfirmed: true }) });
        if ([401, 403, 409, 422].includes(response.status)) {
          setData(null); setError("Training or access changed, or the details were rejected. Check status before continuing."); return;
        }
        const parsed = bookingTestPaymentSnapshotSchema.safeParse((await response.json()).data);
        if (!response.ok || !parsed.success || parsed.data.reservationId !== reservationId || parsed.data.generation !== data.generation || !parsed.data.enabled || parsed.data.receipt?.amount !== amount) throw new Error();
        setData(parsed.data);
      } catch { setUncertain(true); setError("The result is uncertain. Check status to review the saved test payment before doing anything else."); }
      finally { requestLock.current = false; setBusy(false); }
    }}>
      <label>Test amount (R)<input name="testAmount" type="number" min="0.01" max="10000000" step="0.01" defaultValue={requiredAmount} required disabled={busy || uncertain} style={{ maxWidth: "100%" }} /></label>
      <label className="handover-attestation"><input type="checkbox" required disabled={busy || uncertain} /> I am recording a test only; no funds have been received.</label>
      <button className="button button-primary" disabled={busy || uncertain}>Record test payment</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void read()} style={{ marginTop: 12 }}>{busy ? "Checking…" : "Check test-payment status"}</button>
  </section>;
}
