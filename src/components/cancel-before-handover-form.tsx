"use client";

import { useActionState } from "react";
import { cancelBeforeHandoverAction } from "@/app/actions/leasing";

export function CancelBeforeHandoverForm({ reservationId }: { reservationId: string }) {
  const [state, submit, pending] = useActionState(
    async (_previous: { error: string } | undefined, data: FormData) => cancelBeforeHandoverAction(data),
    undefined,
  );
  return <details className="panel panel-spacious">
    <summary>Cancel before key handover</summary>
    <p>This closes the booking and clears its unit allocation. The signed agreement and ledger remain in history. Finance must resolve any outstanding balance or payment first.</p>
    <form action={submit} className="move-in-form">
      <input type="hidden" name="reservationId" value={reservationId} />
      <label>Reason for cancellation <input name="reason" required maxLength={500} disabled={pending} /></label>
      <label><input type="checkbox" name="keysNotHandedOver" required disabled={pending} /> I confirm that keys were never handed over.</label>
      {state?.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button button-secondary" disabled={pending}>{pending ? "Cancelling booking…" : "Confirm cancellation"}</button>
    </form>
  </details>;
}
