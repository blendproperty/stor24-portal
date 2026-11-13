"use client";
/* eslint-disable @next/next/no-img-element -- Private previews must not enter the image optimiser. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

type Person = { id: string; name: string; status: string; photoVersion: number; expiresAt: string | null; facilityId: string; facilityName: string; unitNumber: string };
type Policy = { hash: string; notice: string; consentLabel: string; retentionHours: number };

export function AdditionalAccessQueue({ people, policy, manageableFacilities }: { people: Person[]; policy: Policy | null; manageableFacilities: string[] | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ id: string; version: number; url: string; expiresAt: string | null } | null>(null);
  const [handoff, setHandoff] = useState<{ id: string; url: string; qr: string; expiresAt: string } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setPreview(null), Math.min(60000, Math.max(0, preview.expiresAt ? new Date(preview.expiresAt).getTime() - Date.now() : 0)));
    return () => { clearTimeout(timer); URL.revokeObjectURL(preview.url); };
  }, [preview]);
  async function capture(form: HTMLFormElement) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/access/additional-people", { method: "POST", body: new FormData(form) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      form.reset(); setMessage("Photo saved for review. Access is not active."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save photo."); }
    finally { setBusy(false); }
  }
  async function open(person: Person) {
    setPreview(null); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/access/additional-people?${new URLSearchParams({ id: person.id, version: String(person.photoVersion) })}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error);
      setPreview({ id: person.id, version: person.photoVersion, url: URL.createObjectURL(await response.blob()), expiresAt: person.expiresAt });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Photo unavailable."); }
    finally { setBusy(false); }
  }
  async function review(person: Person, decision: "APPROVE" | "REJECT") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/access/additional-people?${new URLSearchParams({ id: person.id, version: String(person.photoVersion), decision })}`, { method: "PATCH" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setMessage(decision === "APPROVE" ? "Photo reviewed. Hikvision access is not active." : "Photo rejected and removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save review."); }
    finally { setPreview(null); setBusy(false); router.refresh(); }
  }
  async function withdraw(person: Person) {
    if (!window.confirm("Remove this person's stored photo and record consent withdrawal?")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/access/additional-people?${new URLSearchParams({ id: person.id, version: String(person.photoVersion) })}`, { method: "DELETE" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setPreview(null); setMessage("Photo removed. Provider and device deletion must be confirmed separately.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove photo."); }
    finally { setBusy(false); }
  }
  async function startHandoff(person: Person) {
    if (!window.confirm(`I have checked ${person.name}'s identity in person. Create a five-minute capture link for this person?`)) return;
    setBusy(true); setMessage(""); setHandoff(null);
    try {
      const response = await fetch("/api/v1/access/additional-people/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: person.id, version: person.photoVersion, identityConfirmed: true }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      const url = `${window.location.origin}/access/capture/${result.data.token}`;
      setHandoff({ id: person.id, url, qr: await QRCode.toDataURL(url, { margin: 2, width: 240 }), expiresAt: result.data.expiresAt });
      setMessage("Open this link on an unsigned customer tablet. The person must consent and take their own photo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create capture link."); }
    finally { setBusy(false); }
  }
  return <section className="panel panel-spacious">
    <h2>Additional people</h2>
    <p>Customers nominate people against their booking. Each person must be present to read the notice and consent. Photo review does not activate Hikvision access.</p>
    {!policy && <p>Additional-person photo collection is unavailable until its separate policy is configured.</p>}
    {message && <p role="status">{message}</p>}
    {preview && <aside><img src={preview.url} alt="Private access photo" width={240} /><button type="button" onClick={() => setPreview(null)}>Close photo</button></aside>}
    {people.length === 0 && <p>No additional people nominated.</p>}
    {people.map(person => {
      const canManage = manageableFacilities === null || manageableFacilities.includes(person.facilityId);
      return <article key={person.id}>
        <h3>{person.name}</h3><p>{person.facilityName} · Unit {person.unitNumber} · {person.status.replaceAll("_", " ")} · Access not active</p>
        {canManage && policy && person.status !== "WAITING_REVIEW" && <button className="button button-primary" type="button" disabled={busy} onClick={() => void startHandoff(person)}>Hand customer tablet to {person.name}</button>}
        {handoff?.id === person.id && <aside><p>Expires {new Date(handoff.expiresAt).toLocaleTimeString()}. Use a tablet without a staff login.</p><img src={handoff.qr} width={240} height={240} alt="QR code for the private photo capture link" /><p><a href={handoff.url} target="_blank" rel="noreferrer">Open capture link in a separate browser</a></p><button type="button" onClick={() => setHandoff(null)}>Hide link</button></aside>}
        {canManage && policy && person.status !== "WAITING_REVIEW" && <form onSubmit={event => { event.preventDefault(); void capture(event.currentTarget); }}>
          <input type="hidden" name="id" value={person.id} /><input type="hidden" name="version" value={person.photoVersion} /><input type="hidden" name="policyHash" value={policy.hash} />
          <p>{policy.notice}</p><p>Photo retention: {policy.retentionHours} hours.</p>
          <label>Photo <input name="image" type="file" accept="image/jpeg,image/png" required disabled={busy} /></label>
          <label><input name="consent" type="checkbox" required disabled={busy} /> The person is present, has read the notice and has personally confirmed: {policy.consentLabel}</label>
          <label><input name="identityConfirmed" type="checkbox" required disabled={busy} /> I have checked this person’s identity against the nominated name.</label>
          <button className="button button-secondary" disabled={busy}>Capture photo</button>
        </form>}
        {canManage && person.status === "WAITING_REVIEW" && <div>
          <button className="button button-secondary" disabled={busy} onClick={() => void open(person)}>View privately</button>
          <button className="button button-primary" disabled={busy || preview?.id !== person.id || preview.version !== person.photoVersion} onClick={() => void review(person, "APPROVE")}>Approve photo</button>
          <button className="button button-secondary" disabled={busy} onClick={() => void review(person, "REJECT")}>Reject photo</button>
        </div>}
        {canManage && ["WAITING_REVIEW", "APPROVED"].includes(person.status) && <button className="button button-secondary" disabled={busy} onClick={() => void withdraw(person)}>Withdraw consent and remove photo</button>}
      </article>;
    })}
  </section>;
}
