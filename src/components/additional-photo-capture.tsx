"use client";

import { useState } from "react";
import "@/styles/facial-access.css";

export function AdditionalPhotoCapture({ token, details }: { token: string; details: { name: string; notice: string; consentLabel: string; retentionHours: number; policyHash: string } }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  async function submit(form: HTMLFormElement) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(form); body.set("image", file);
      const response = await fetch("/api/access/capture", { method: "POST", body, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDone(true); setFile(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please ask staff to try again."); }
    finally { setBusy(false); }
  }
  return <main className="tenant-card face-tenant" style={{ maxWidth: 650, margin: "2rem auto" }}>
    <h1>Photograph for {details.name}</h1>
    {done ? <p role="status">Your photo was saved for staff review. This has not activated door access. Please hand the tablet back to staff.</p> : <form onSubmit={event => { event.preventDefault(); void submit(event.currentTarget); }}>
      <p>This step is for {details.name} only. Please read the notice and choose whether to provide your own photograph.</p>
      <p>{details.notice}</p>
      <p>Photo retention: up to {details.retentionHours} hours.</p>
      <input type="hidden" name="token" value={token} /><input type="hidden" name="policyHash" value={details.policyHash} />
      <label className="face-photo-picker">Take your photo with the front camera
        <input type="file" aria-label="Take your access photograph" accept="image/jpeg,image/png" capture="user" onChange={event => setFile(event.target.files?.[0] ?? null)} disabled={busy} />
      </label>
      <label className="face-photo-picker">Or choose an existing photo
        <input type="file" aria-label="Choose your access photograph" accept="image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0] ?? null)} disabled={busy} />
      </label>
      {file && <p>Selected: {file.name}</p>}
      <label className="face-checkbox"><input type="checkbox" name="consent" required disabled={busy} /> {details.consentLabel}</label>
      <button className="face-submit" disabled={!file || busy}>{busy ? "Saving securely…" : "Submit my photograph"}</button>
      <p>Staff will review the image. Door access requires separate activation and verification.</p>
      {error && <p role="alert">{error}</p>}
    </form>}
  </main>;
}
