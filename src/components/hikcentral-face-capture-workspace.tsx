"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type Person = { customerId: string; customerName: string; personId: string; photo: { id: string; version: number; status: string; consentAt: string; providerAcceptedAt: string | null } | null };
type Facility = { id: string; name: string };

export function HikCentralFaceCaptureWorkspace({ people, facilities, canSend }: { people: Person[]; facilities: Facility[]; canSend: boolean }) {
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [identityChecked, setIdentityChecked] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [handoff, setHandoff] = useState<{ url: string; qr: string; expiresAt: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const person = people.find(item => item.customerId === customerId);
  const visible = people.filter(item => item.customerId === customerId || item.customerName.toLowerCase().includes(search.toLowerCase())).slice(0, 50);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function prepare() {
    if (!person || !facilityId) return;
    setBusy(true); setError(""); setHandoff(null);
    try {
      const response = await fetch("/api/v1/access/hikcentral-face", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", customerId, facilityId, version: person.photo?.version ?? 0, identityChecked }), cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw Error(body.error?.message ?? body.error ?? "Could not prepare the customer photo screen.");
      const url = `https://stor24.co.za/walk-in/photo#capture=${body.data.token}`;
      setHandoff({ url, qr: await QRCode.toDataURL(url, { margin: 2, width: 240 }), expiresAt: body.data.expiresAt });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare the customer photo screen."); }
    finally { setBusy(false); }
  }

  async function openPhoto() {
    if (!person?.photo) return;
    setBusy(true); setError(""); setPreview(null); setReviewConfirmed(false);
    try {
      const query = new URLSearchParams({ id: person.photo.id, version: String(person.photo.version) });
      const response = await fetch(`/api/v1/access/hikcentral-face?${query}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw Error(body.error?.message ?? body.error ?? "Photo review unavailable."); }
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Photo review unavailable."); }
    finally { setBusy(false); }
  }

  async function decide(action: "SEND" | "REJECT") {
    if (!person?.photo) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/access/hikcentral-face", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: person.photo.id, version: person.photo.version }), cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw Error(body.error?.message ?? body.error ?? "HikCentral status could not be confirmed.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HikCentral status could not be confirmed. Do not submit again before checking its person record."); }
    finally { setBusy(false); }
  }

  return <section className="panel panel-spacious" aria-label="Capture a customer face for HikCentral">
    <div className="panel-heading"><div><h2>Customer face for HikCentral</h2><p className="panel-subtitle">Capture once per customer, across their units. The customer uses the separate Counter screen; staff review the image before sending it to the linked HikCentral person.</p></div></div>
    <div className="form-grid">
      <div className="field"><label htmlFor="face-customer-search">Find customer</label><input id="face-customer-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /><label htmlFor="face-customer">Customer with linked HikCentral person</label><select id="face-customer" value={customerId} onChange={event => { setCustomerId(event.target.value); setHandoff(null); setPreview(null); setIdentityChecked(false); setReviewConfirmed(false); setError(""); }}><option value="">Select customer</option>{visible.map(item => <option key={item.customerId} value={item.customerId}>{item.customerName}</option>)}</select></div>
      <label className="field"><span>Facility for this visit</span><select value={facilityId} onChange={event => { setFacilityId(event.target.value); setHandoff(null); }}>{facilities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {person ? <div className="hikcentral-link-preview"><p><strong>{person.customerName}</strong> · HikCentral person {person.personId}</p><p>Photo status: <strong>{person.photo?.status.replaceAll("_", " ").toLowerCase() ?? "not captured"}</strong>. {person.photo?.status === "PROVIDER_ACCEPTED" ? "HikCentral accepted the update and the person record was read back. Reader distribution still needs a separate check." : null}{person.photo?.status === "PROVIDER_UNCERTAIN" ? "The provider result is uncertain. Check HikCentral before any new upload." : null}</p>
      {(!person.photo || ["EXPIRED", "REJECTED", "WITHDRAWN", "PROVIDER_ACCEPTED"].includes(person.photo.status)) ? <><p><strong>1. Prepare customer capture</strong> · Check the original ID, then let the customer use the unsigned Counter tablet.</p><label><input type="checkbox" checked={identityChecked} onChange={event => setIdentityChecked(event.target.checked)} /> I checked this customer&apos;s original identity document in person.</label><div><button className="button button-primary" type="button" disabled={busy || !identityChecked || !facilityId} onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare customer photo screen"}</button></div></> : null}
      {handoff ? <div><p>Scan this QR on the Counter tablet. It works once and expires at {new Date(handoff.expiresAt).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })}. Keep the staff portal on your own screen.</p><Image src={handoff.qr} alt="Scan to open the customer-only HikCentral photo screen" width={240} height={240} unoptimized /><p>When the customer sees “Your photo was saved”, take the tablet back and refresh here.</p><button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Check saved photo</button></div> : null}
      {person.photo?.status === "WAITING_REVIEW" ? <div><p><strong>2. Review and send</strong> · Open the exact submitted image. Sending it replaces this person&apos;s current HikCentral face and may affect access that already works.</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void openPhoto()}>Open photo for private review</button>{preview ? <div><Image src={preview} alt={`Private facial photo submitted by ${person.customerName}`} width={320} height={320} unoptimized style={{ maxWidth: "100%", height: "auto", objectFit: "contain" }} /><label><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /> This image matches the original ID and is suitable for HikCentral.</label><div className="button-row"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void decide("REJECT")}>Reject and erase</button>{canSend ? <button className="button button-primary" type="button" disabled={busy || !reviewConfirmed} onClick={() => void decide("SEND")}>{busy ? "Sending…" : "Send reviewed photo to HikCentral"}</button> : <p>An integration manager must approve the send.</p>}</div></div> : null}</div> : null}
    </div> : <p>Select a linked customer to begin. If the customer is missing, link their existing HikCentral person below.</p>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
