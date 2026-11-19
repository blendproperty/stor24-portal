"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type Person = { customerId: string; customerName: string; personId: string | null; linkStatus: string | null; accessGrants?: { facilityId: string; status: string }[]; photo: { id: string; version: number; status: string; consentAt: string; providerAcceptedAt: string | null } | null };
type Facility = { id: string; name: string };
type AccessState = { eligible: boolean; arrearsLocked: boolean; restorationReady: boolean; blockers: string[]; grants: { accessLevelId: string; status: string; grantedAt: string | null; revokedAt: string | null; lastError: string | null }[] };

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
  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const person = people.find(item => item.customerId === customerId);
  const linkNeedsReview = person && (["DUPLICATE_SUSPECTED", "SUPERSEDED"].includes(person.linkStatus ?? "") || (person.personId && person.linkStatus !== "ACTIVE"));
  const visible = people.filter(item => item.customerId === customerId || item.customerName.toLowerCase().includes(search.toLowerCase())).slice(0, search.trim() ? 50 : 10);
  function accessLabel(item: Person) {
    const all = (item.accessGrants ?? []).filter(grant => grant.facilityId === facilityId);
    const grants = all.filter(grant => grant.status !== "REVOKED");
    if (grants.some(grant => grant.status === "REVIEW_REQUIRED")) return { text: "Needs review", tone: "warning" };
    if (grants.some(grant => grant.status === "LOCKED")) return { text: "Locked · manager restore", tone: "danger" };
    if (grants.some(grant => grant.status === "EXTERNAL")) return { text: "Manually assigned · review", tone: "warning" };
    if (grants.length === 2 && grants.every(grant => grant.status === "GRANTED")) return { text: "Assigned in HikCentral", tone: "success" };
    if (grants.length) return { text: "Partially assigned", tone: "warning" };
    if (all.some(grant => grant.status === "REVOKED")) return { text: "Access removed", tone: "danger" };
    return { text: "Not assigned", tone: "neutral" };
  }
  function selectCustomer(id: string) { setCustomerId(id); setAccessState(null); setHandoff(null); setPreview(null); setIdentityChecked(false); setReviewConfirmed(false); setError(""); }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!customerId || !facilityId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/access/hikcentral-customer-access?${new URLSearchParams({ customerId, facilityId })}`, { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(body => { if (body?.data) setAccessState(body.data); }).catch(() => {});
    return () => controller.abort();
  }, [customerId, facilityId]);

  async function checkAccess(action?: "restore") {
    if (!customerId || !facilityId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/access/hikcentral-customer-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, facilityId, action }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message ?? body.error ?? "Access could not be confirmed.");
      const readback = await fetch(`/api/v1/access/hikcentral-customer-access?${new URLSearchParams({ customerId, facilityId })}`, { cache: "no-store" });
      if (readback.ok) setAccessState((await readback.json()).data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Access could not be confirmed."); }
    finally { setBusy(false); }
  }

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

  async function checkDeletedPerson() {
    if (!person?.personId || !facilityId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/access/hikcentral-person-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcileDeleted", facilityId, customerId: person.customerId, expectedPersonId: person.personId }), cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw Error(body.error?.message ?? "HikCentral person could not be reconciled.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HikCentral person could not be reconciled."); }
    finally { setBusy(false); }
  }

  return <section id="face-capture" className="panel panel-spacious hikcentral-capture" aria-label="Capture a customer face for HikCentral">
    <div className="panel-heading"><div><span className="face-step-label">Staff and customer</span><h2>Take the photo on the tablet</h2><p className="panel-subtitle">Choose the STOR24 customer and check their original ID. Prepare the QR code, then the customer takes their own photo on the separate Counter screen. Staff need no HikCentral login.</p></div></div>
    <div className="form-grid">
      <div className="field"><label htmlFor="face-customer-search">Find customer</label><input id="face-customer-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /></div>
      <label className="field"><span>Facility for this visit</span><select value={facilityId} onChange={event => { setFacilityId(event.target.value); setHandoff(null); }}>{facilities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="face-customer-table-wrap"><table className="face-customer-table"><caption>Customer photo, HikCentral person and face reader access. Assigned access still needs a physical reader test.</caption><thead><tr><th scope="col">Customer</th><th scope="col">Photo</th><th scope="col">HikCentral person ID</th><th scope="col">Face reader access</th><th scope="col">Details</th></tr></thead><tbody>{visible.map(item => { const access = accessLabel(item); const photoStatus = item.photo?.status ?? "NOT_CAPTURED"; return <tr key={item.customerId} aria-selected={item.customerId === customerId}><th scope="row">{item.customerName}</th><td data-label="Photo"><span className={`face-status face-status--${photoStatus === "PROVIDER_ACCEPTED" ? "success" : photoStatus === "NOT_CAPTURED" ? "neutral" : "warning"}`}>{({ WAITING_REVIEW: "Saved · awaiting review", SENDING: "Sending to HikCentral", PROVIDER_UNCERTAIN: "Provider result uncertain", PROVIDER_ACCEPTED: "Accepted by HikCentral", REJECTED: "New photo needed", EXPIRED: "Photo expired", WITHDRAWN: "Photo withdrawn", PROVIDER_REMOVED: "New photo needed", NOT_CAPTURED: "Not captured" } as Record<string, string>)[photoStatus] ?? "Check status"}</span></td><td data-label="HikCentral ID">{item.personId ?? "Not linked"}</td><td data-label="Face reader access"><span className={`face-status face-status--${access.tone}`}>{access.text}</span></td><td data-label="Details"><button className="button button-secondary" type="button" aria-current={item.customerId === customerId ? "true" : undefined} onClick={() => selectCustomer(item.customerId)}>{item.customerId === customerId ? "Viewing details" : "View photo & access"}</button></td></tr>; })}</tbody></table>{visible.length === 0 ? <p>No matching customers. Search for a STOR24 customer record.</p> : !search.trim() && people.length > visible.length ? <p>Showing 10 recent customers. Search by name to find another.</p> : null}</div>
    {person ? <div className="hikcentral-link-preview"><p><strong>{person.customerName}</strong> · {person.personId ? "Existing HikCentral record linked" : "No HikCentral record linked yet"}</p><p>Photo status: <strong>{person.photo?.status.replaceAll("_", " ").toLowerCase() ?? "not captured"}</strong>. {person.photo?.status === "PROVIDER_ACCEPTED" ? "HikCentral accepted the person and face. Reader distribution and door permission need separate checks." : null}{person.photo?.status === "PROVIDER_UNCERTAIN" ? "The provider result is uncertain. Ask the integration manager to check HikCentral before any new upload." : null}</p>
      {linkNeedsReview ? <p role="alert">This customer&apos;s provider identity needs manager review before a photo visit.</p> : null}
      {canSend && person.personId && person.photo?.status === "PROVIDER_ACCEPTED" ? <div><p>If this person was deleted directly in HikCentral, check and reconcile the old link before another capture. This does not grant doors.</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void checkDeletedPerson()}>{busy ? "Checking…" : "Check deleted HikCentral person"}</button></div> : null}
      {!linkNeedsReview && (!person.photo || ["EXPIRED", "REJECTED", "WITHDRAWN", "PROVIDER_ACCEPTED", "PROVIDER_REMOVED"].includes(person.photo.status)) ? <><p>{person.photo?.status === "PROVIDER_ACCEPTED" ? "Recapture replaces this customer's current HikCentral face after a fresh consent, staff review and provider readback. Existing door permissions are tracked separately." : "Check the original ID against the STOR24 customer record, then prepare the one-use QR. If the person is already in HikCentral, ask an integration manager to link them first. Otherwise, HikCentral assigns a new person ID after photo review."}</p><label><input type="checkbox" checked={identityChecked} onChange={event => setIdentityChecked(event.target.checked)} /> I checked this customer&apos;s original identity document against the STOR24 record in person.</label><div><button className="button button-primary" type="button" disabled={busy || !identityChecked || !facilityId} onClick={() => void prepare()}>{busy ? "Preparing…" : person.photo?.status === "PROVIDER_ACCEPTED" ? "Recapture / replace face" : "Prepare customer photo screen and QR"}</button></div></> : null}
      {handoff ? <div className="face-handoff" aria-live="polite"><div><h3>QR ready for the tablet</h3><ol><li>Open the tablet camera and point it at this QR.</li><li>Tap the link that appears. The customer reads the notice, agrees and takes their own photo.</li><li>When the tablet says “Your photo was saved”, take it back and check the photo here.</li></ol><p>This QR works once and expires at {new Date(handoff.expiresAt).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })}.</p><button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Check saved photo</button></div><Image src={handoff.qr} alt="Scan to open the customer-only HikCentral photo screen" width={240} height={240} unoptimized /></div> : null}
      {person.photo?.status === "WAITING_REVIEW" ? <div className="face-review-block"><h3>Review and send</h3><p>Open the exact submitted image. Sending it {person.personId ? "replaces this person's current HikCentral face and may affect access that already works" : "creates a new STOR24 HikCentral person with this face, without granting a door"}.</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void openPhoto()}>Open photo for private review</button>{preview ? <div><Image src={preview} alt={`Private facial photo submitted by ${person.customerName}`} width={320} height={320} unoptimized style={{ maxWidth: "100%", height: "auto", objectFit: "contain" }} /><label><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /> This image matches the original ID and is suitable for HikCentral.</label><div className="button-row"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void decide("REJECT")}>Reject and erase</button>{canSend ? <button className="button button-primary" type="button" disabled={busy || !reviewConfirmed} onClick={() => void decide("SEND")}>{busy ? "Sending…" : person.personId ? "Update HikCentral face" : "Create HikCentral person with photo"}</button> : <p>An integration manager must approve the send.</p>}</div></div> : null}</div> : null}
      <div className="face-review-block" aria-live="polite"><h3>Face reader access</h3><p>HikCentral person and photo are separate from door rights. An active, handed-over tenancy and the exact Block24 and Midpoint visitor face-reader mapping are required.</p>{accessState ? <><p><strong>{accessState.grants.some(item => item.status === "REVIEW_REQUIRED") ? "Needs manager review" : accessState.grants.some(item => item.status === "LOCKED") ? "Locked · manager restoration required" : accessState.grants.some(item => item.status === "EXTERNAL") ? "Manual access must be reconciled" : accessState.grants.length === 2 && accessState.grants.every(item => item.status === "GRANTED") ? "Both access levels assigned in HikCentral" : "Door access not confirmed"}</strong></p>{accessState.blockers.length ? <ul>{accessState.blockers.map(item => <li key={item}>{item}</li>)}</ul> : null}{accessState.grants.length ? <table className="face-customer-table"><thead><tr><th>Access level ID</th><th>State</th></tr></thead><tbody>{accessState.grants.map(item => <tr key={item.accessLevelId}><td>{item.accessLevelId}</td><td>{item.status.replaceAll("_", " ").toLowerCase()}</td></tr>)}</tbody></table> : null}</> : <p>Checking access state…</p>}{canSend ? <><button className="button button-secondary" type="button" disabled={busy} onClick={() => void checkAccess()}>{busy ? "Checking…" : "Check and reconcile access"}</button>{accessState?.eligible && accessState.restorationReady && accessState.grants.length === 2 && accessState.grants.every(item => item.status === "LOCKED") ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void checkAccess("restore")}>Approve restoration after payment check</button> : null}</> : null}<p>Membership confirmation is an API readback. Reader distribution and physical entry still need a site test.</p></div>
    </div> : <div className="face-next-step"><strong>Where is the QR code?</strong><p>Open a customer in the table, check their original ID and press “Prepare customer photo screen and QR”. If this person already exists in HikCentral, an integration manager must link that record first.</p></div>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
