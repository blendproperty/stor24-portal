"use client";
import "@/styles/facial-access.css";

import { useEffect, useState } from "react";
import { ArrowRight, Camera, Check, ChevronDown, Clock3, FileImage, RefreshCw, ScanFace, ShieldCheck } from "lucide-react";

type PhotoState = {
  available: boolean;
  policy: { version: string; hash: string; notice: string; consentLabel: string; retentionHours: number | null; alternativeContact: string } | null;
  photo: { version: number; status: string; expiresAt: string | null; erasedAt: string | null } | null;
};
const labels: Record<string, string> = { WAITING_REVIEW: "Photo received · awaiting staff review", APPROVED: "Photo reviewed · awaiting move-in", PENDING_PROVIDER: "Move-in recorded · access activation pending", EXPIRED: "Photo expired · a new photo will be needed", WITHDRAWN: "Consent withdrawn · stored photo removed", REJECTED: "New photograph needed" };

export function TenantFacePhoto({ reservationId }: { reservationId: string }) {
  const [state, setState] = useState<PhotoState | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [fileName, setFileName] = useState("");
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
      form.reset(); setFileName(""); setState(null); setRevision(value => value + 1);
    } catch (err) { form.reset(); setFileName(""); setState(null); setError(err instanceof Error ? err.message : "Your photo could not be saved. Please refresh."); }
    finally { setBusy(false); }
  }
  return <section className="tenant-card face-tenant">
    <header className="face-customer-heading">
      <span className="face-customer-eyebrow">PART OF YOUR MOVE-IN</span>
      <h2>Your photograph for precinct access.</h2>
      <p>Your photo will be uploaded and added to the precinct’s facial recognition system as part of your move-in, so you can enter the precinct.</p>
    </header>
    <div className="face-customer-layout">
    <aside className="face-photo-guide">
      <div className="face-portrait-mark"><ScanFace size={68} strokeWidth={1.15} aria-hidden="true" /></div>
      <h3>A clear view of you.</h3>
      <p>Look straight at the camera, with your whole face in good light.</p>
      <ul><li><Check size={15} aria-hidden="true" /> Face the camera</li><li><Check size={15} aria-hidden="true" /> Keep your face unobstructed</li><li><Check size={15} aria-hidden="true" /> Use a plain background</li></ul>
      <div className="face-guide-next"><span>WHAT HAPPENS NEXT</span><p>Our team reviews your photo and arranges your enrolment. At move-in, staff check your identity, hand over your keys and confirm that your precinct access is active.</p></div>
    </aside>
    <div className="face-customer-form">
    <div className="face-form-title"><h3>Your access photograph</h3><span><ShieldCheck size={14} aria-hidden="true" /> Private upload</span></div>
    {state?.photo && <p className="face-status" role="status">{labels[state.photo.status] ?? "Staff review required"}</p>}
    {state && !state.available && <div className="face-collection-hold"><Clock3 size={24} aria-hidden="true" /><h4>Photo collection isn’t open yet</h4><p>{state.policy ? "Uploads are currently unavailable for this booking. Contact your store to arrange access." : "Photo upload is not available yet. Your store will arrange this step with you as part of your move-in."}</p></div>}
    {!state && !error && <p role="status">Checking your photo status…</p>}
    {state?.available && state.policy && <form key={`${state.photo?.version ?? 0}:${state.policy.hash}`} onSubmit={event => { event.preventDefault(); void upload(event.currentTarget); }}>
      <input type="hidden" name="reservationId" value={reservationId} /><input type="hidden" name="version" value={state.photo?.version ?? 0} /><input type="hidden" name="policyHash" value={state.policy.hash} />
      <label className={`face-photo-picker${fileName ? " has-file" : ""}`}>
        <span className="face-picker-icon">{fileName ? <FileImage size={25} aria-hidden="true" /> : <Camera size={25} aria-hidden="true" />}</span>
        <strong>{fileName || "Add your photograph"}</strong>
        <span>{fileName ? "Tap to choose a different photo" : "Take a photo or choose one from your device"}</span>
        <span className="face-picker-action">{fileName ? "Change photo" : "Choose photo"}<ArrowRight size={15} aria-hidden="true" /></span>
        <input aria-label="Choose your access photograph" name="image" type="file" accept="image/jpeg,image/png" required disabled={busy} onChange={event => setFileName(event.currentTarget.files?.[0]?.name ?? "")} />
      </label>
      <p className="face-format-note">JPEG or PNG · Up to 5 MB{state.photo ? " · A replacement needs a new staff review." : ""}</p>
      <details><summary>How we use your photograph<ChevronDown size={17} aria-hidden="true" /></summary><p className="face-consent">{state.policy.notice}</p><p>{state.policy.retentionHours === null ? "Retained during your active booking and tenancy. Removed when the booking or tenancy ends, or you withdraw consent." : `Available for staff review for up to ${state.policy.retentionHours} hours.`} The notice explains the deletion arrangements.</p><p>{state.policy.alternativeContact}</p></details>
      <label className="face-checkbox"><input name="consent" type="checkbox" required disabled={busy} /><span>{state.policy.consentLabel}</span></label>
      <button className="face-submit" disabled={busy}>{busy ? "Saving securely…" : state.photo ? "Replace my photograph" : "Submit photograph"}<ArrowRight size={18} aria-hidden="true" /></button>
      <p className="face-activation-note">Our team will confirm when your precinct access is active.</p>
    </form>}
    {state?.photo && ["WAITING_REVIEW", "APPROVED", "PENDING_PROVIDER"].includes(state.photo.status) && <button className="face-text-button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch(`/api/tenant/access-photo?${new URLSearchParams({ reservationId, version: String(state.photo!.version) })}`, { method: "DELETE" });
        const body = await response.json(); if (!response.ok) throw new Error(body.error);
        setFileName(""); setState(null); setRevision(value => value + 1);
      } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
      finally { setBusy(false); }
    }}>Withdraw consent and remove my photo</button>}
    {error && <p className="face-customer-error" role="alert">{error}</p>}
    </div></div>
    <footer className="face-customer-footer"><p><ShieldCheck size={17} aria-hidden="true" /> Only authorised store staff can review your photo.</p><button className="face-text-button" disabled={busy} onClick={() => { setFileName(""); setState(null); setRevision(value => value + 1); }}><RefreshCw size={14} aria-hidden="true" /> Refresh status</button></footer>
  </section>;
}
