"use client";
import "@/styles/facial-access.css";

import { useEffect, useState } from "react";
import { Camera, ShieldCheck } from "lucide-react";

type PhotoState = {
  available: boolean;
  policy: { version: string; hash: string; notice: string; consentLabel: string; retentionHours: number; alternativeContact: string } | null;
  photo: { version: number; status: string; expiresAt: string; erasedAt: string | null } | null;
};
const labels: Record<string, string> = { WAITING_REVIEW: "Photo received · awaiting staff review", APPROVED: "Photo reviewed · awaiting move-in", PENDING_PROVIDER: "Move-in recorded · access activation pending", EXPIRED: "Photo expired · a new photo will be needed", WITHDRAWN: "Consent withdrawn · stored photo removed", REJECTED: "New photograph needed" };

export function TenantFacePhoto({ reservationId }: { reservationId: string }) {
  const [state, setState] = useState<PhotoState | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tenant/access-photo?${new URLSearchParams({ reservationId })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (!controller.signal.aborted) { setState(body.data); setError(""); }
    }).catch(err => { if (!controller.signal.aborted) { setState(null); setError(err instanceof Error ? err.message : "Please refresh your account."); } });
    return () => controller.abort();
  }, [reservationId, revision]);
  async function upload(form: HTMLFormElement) {
    setBusy(true); setError("");
    try {
      const data = new FormData(form);
      const response = await fetch("/api/tenant/access-photo", { method: "POST", body: data });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      form.reset(); setState(null); setRevision(value => value + 1);
    } catch (err) { form.reset(); setState(null); setError(err instanceof Error ? err.message : "Your photo could not be saved. Please refresh."); }
    finally { setBusy(false); }
  }
  return <section className="tenant-card face-tenant">
    <span className="tenant-eyebrow"><Camera size={16} aria-hidden="true" /> ARRIVING AT YOUR SPACE</span>
    <h2>Your access photograph</h2>
    <p>Upload privately, then let our team check your photo and confirm your move-in. Your photo alone does not enable entry.</p>
    {state?.photo && <p className="face-status" role="status">{labels[state.photo.status] ?? "Staff review required"}</p>}
    {state && !state.available && <p>{state.policy ? "Uploads are currently unavailable for this booking. Contact your store to arrange access." : "Facial access is being prepared. Your store will confirm how to access your unit."}</p>}
    {state?.available && state.policy && <form key={`${state.photo?.version ?? 0}:${state.policy.hash}`} onSubmit={event => { event.preventDefault(); void upload(event.currentTarget); }}>
      <input type="hidden" name="reservationId" value={reservationId} /><input type="hidden" name="version" value={state.photo?.version ?? 0} /><input type="hidden" name="policyHash" value={state.policy.hash} />
      <label>A clear photograph of your face<input name="image" type="file" accept="image/jpeg,image/png" capture="user" required disabled={busy} /></label>
      <p>Face the camera in good light. JPEG or PNG, up to 5 MB. Replacing a photo requires a fresh staff review.</p>
      <details><summary>How your photograph will be used</summary><p className="face-consent">{state.policy.notice}</p><p>Available for staff review for up to {state.policy.retentionHours} hours. The notice explains the deletion arrangements.</p><p>{state.policy.alternativeContact}</p></details>
      <label className="face-checkbox"><input name="consent" type="checkbox" required disabled={busy} /><span>{state.policy.consentLabel}</span></label>
      <button className="tenant-primary" disabled={busy}>{busy ? "Saving securely…" : state.photo ? "Replace my photograph" : "Submit my photograph"}</button>
    </form>}
    {state?.photo && ["WAITING_REVIEW", "APPROVED", "PENDING_PROVIDER"].includes(state.photo.status) && <button className="tenant-secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch(`/api/tenant/access-photo?${new URLSearchParams({ reservationId, version: String(state.photo!.version) })}`, { method: "DELETE" });
        const body = await response.json(); if (!response.ok) throw new Error(body.error);
        setState(null); setRevision(value => value + 1);
      } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
      finally { setBusy(false); }
    }}>Withdraw consent and remove my photo</button>}
    {error && <p role="alert">{error}</p>}
    <button className="tenant-secondary" disabled={busy} onClick={() => { setState(null); setRevision(value => value + 1); }}>Refresh photo status</button>
    <p className="tenant-security"><ShieldCheck size={17} aria-hidden="true" /> Only authorised store staff can review your submitted photograph.</p>
  </section>;
}
