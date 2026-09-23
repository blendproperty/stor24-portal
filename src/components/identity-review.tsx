"use client";
/* eslint-disable @next/next/no-img-element -- Private blob previews must never pass through the image optimiser or a shared cache. */
import { useCallback, useEffect, useRef, useState } from "react";
type Document = { id: string; version: number; status: string; pageCount: number; documentType: string; retentionMode?: string; expiresAt: string | null; erasedAt: string | null; replacementReason: string | null; reservation: { status?: string; publicReference: string | null; facility: { name: string }; unit: { number: string }; customer: { firstName: string | null; lastName: string | null; companyName: string | null } } };
const labels: Record<string, string> = { AWAITING_REVIEW: "Awaiting review", ACCEPTED: "Accepted", REPLACEMENT_REQUIRED: "Replacement required", WITHDRAWN: "Removed by customer", EXPIRED: "Copy expired" };
const reasons = ["Image is not clear enough", "Document is incomplete", "Document details need clarification", "Document is not supported"];
export function IdentityReview({ enabled, reservationId }: { enabled: boolean; reservationId?: string }) {
  const queueUrl = `/api/v1/identity-documents${reservationId ? `?reservation=${encodeURIComponent(reservationId)}` : ""}`;
  const [notice, setNotice] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [selected, setSelected] = useState<Document | null>(null), [preview, setPreview] = useState(""), [viewed, setViewed] = useState<number[]>([]), [reason, setReason] = useState(reasons[0]);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const imageUrl = useRef(""), requestNumber = useRef(0);
  const clear = useCallback(() => { requestNumber.current++; if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); imageUrl.current = ""; setPreview(""); setPreviewPage(null); }, []);
  const load = useCallback(async () => {
    clear(); setSelected(null); setViewed([]); setError("");
    try {
      const response = await fetch(queueUrl, { cache: "no-store" }), body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to load identity reviews.");
      setDocuments(body.data);
      if (reservationId) setSelected(body.data[0] ?? null);
    } catch (e) { setDocuments([]); setError(e instanceof Error ? e.message : "Please try again."); }
  }, [clear, queueUrl, reservationId]);
  useEffect(() => {
    let active = true; const tracker = requestNumber, previewUrl = imageUrl;
    fetch(queueUrl, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to load identity reviews.");
      if (active) { setDocuments(body.data); if (reservationId) setSelected(body.data[0] ?? null); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Please try again."); });
    return () => { active = false; tracker.current++; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); };
  }, [queueUrl, reservationId]);
  useEffect(() => {
    if (!preview) return;
    const timeout = setTimeout(clear, 60000);
    const hide = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hide);
    return () => { clearTimeout(timeout); document.removeEventListener("visibilitychange", hide); };
  }, [preview, clear]);
  async function openPage(document: Document, page: number) {
    clear(); const request = requestNumber.current; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/identity-documents?preview=true&id=${encodeURIComponent(document.id)}&version=${document.version}&page=${page}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? "This copy is unavailable."); }
      const blob = await response.blob();
      if (request !== requestNumber.current) return;
      if (!blob.type.startsWith("image/")) throw new Error("This preview is not a supported image. Please reopen it.");
      imageUrl.current = URL.createObjectURL(blob); setPreviewPage(page); setPreview(imageUrl.current);
    } catch (e) { if (request === requestNumber.current) setError(e instanceof Error ? e.message : "Preview unavailable."); } finally { setBusy(false); }
  }
  async function review(decision: "ACCEPT" | "REPLACE") {
    if (!selected) return; setBusy(true); setError(""); setNotice(""); clear();
    try {
      const response = await fetch("/api/v1/identity-documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, version: selected.version, decision, reason }) }), body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The review could not be saved.");
      await load();
      setNotice(decision === "ACCEPT" ? "Document accepted. Return to move-in checks to see the remaining requirements." : "Replacement requested. The customer must upload a new document before ID review can be completed.");
    } catch (e) { setViewed([]); setError(e instanceof Error ? e.message : "Please refresh and try again."); } finally { setBusy(false); }
  }
  return <main className="identity-review">
    <header><span className="identity-review__eyebrow">CUSTOMER ONBOARDING</span><h1>Identity review</h1><p>A private check before move-in. Review every page and confirm the document matches the booking.</p></header>
    {reservationId && <a className="identity-review__return" href={`/operations/move-in?reservation=${encodeURIComponent(reservationId)}`}>Back to move-in checks</a>}
    {notice && <p className="identity-review__notice" role="status">{notice}</p>}
    {!enabled && <div className="identity-review__notice"><strong>ID collection is on hold.</strong><p>The approved document policy has not been enabled. Existing bookings continue to the normal identity check at key handover.</p></div>}
    <div className="identity-review__bar"><div><strong>{documents.filter(document => document.status === "AWAITING_REVIEW").length}</strong><span>awaiting review</span></div><button disabled={busy} onClick={() => void load()}>Refresh queue</button></div>
    {error && <p className="identity-review__notice" role="alert">{error}</p>}
    <div className="identity-review__layout"><section aria-label="Identity documents"><h2>{reservationId ? "Booking submission" : "Recent submissions"}</h2>{!documents.length && <div className="identity-review__empty"><strong>{reservationId ? "No accessible document for this booking" : "No documents to review"}</strong><p>{reservationId ? "The upload may be missing or outside your permitted stores. Return to move-in checks to confirm the booking." : "Customer uploads will appear here when collection is enabled."}</p></div>}{documents.map(document => <button className={`identity-review__row ${selected?.id === document.id ? "is-selected" : ""}`} disabled={busy} key={document.id} onClick={() => { clear(); setSelected(document); setViewed([]); }}><span><strong>{document.reservation.customer.companyName || [document.reservation.customer.firstName, document.reservation.customer.lastName].filter(Boolean).join(" ") || "Customer"}</strong><small>{document.reservation.facility.name} · Unit {document.reservation.unit.number}</small></span><span className="identity-review__status">{labels[document.status] ?? document.status}</span></button>)}<p className="identity-review__fine">{reservationId ? "Showing only this booking within your permitted stores." : "Showing the 200 most recent submissions within your permitted stores."}</p></section>
    <section className="identity-review__detail" aria-label="Document review">{selected ? <><div className="identity-review__detail-heading"><h2>Unit {selected.reservation.unit.number}</h2><button disabled={busy} onClick={() => { clear(); setSelected(null); setViewed([]); }}>Close preview</button></div><p>{selected.reservation.publicReference} · Version {selected.version}</p><p><strong>{[selected.reservation.customer.firstName, selected.reservation.customer.lastName].filter(Boolean).join(" ") || selected.reservation.customer.companyName}</strong></p><p>{selected.documentType.replaceAll("_", " ")} · {labels[selected.status]}</p>
    {!selected.erasedAt && (selected.retentionMode === "TENANCY" ? selected.expiresAt === null : Boolean(selected.expiresAt && new Date(selected.expiresAt) > new Date())) && ["AWAITING_REVIEW", "ACCEPTED"].includes(selected.status) ? <><div className="identity-review__actions">{Array.from({ length: selected.pageCount }, (_, page) => <button disabled={busy} key={page} onClick={() => void openPage(selected, page)}>Open {selected.pageCount === 2 ? page === 0 ? "front" : "back" : "photo page"}{viewed.includes(page) ? " ✓" : ""}</button>)}</div>{preview && <img key={preview} src={preview} alt="Private identity document for staff review" className="identity-review__image" onLoad={() => { if (previewPage !== null) setViewed(current => [...new Set([...current, previewPage])]); }} onError={() => { const failedPage = previewPage; clear(); setViewed(current => current.filter(page => page !== failedPage)); setError("The image could not be displayed. Reopen this page to retry; it has not been marked as reviewed."); }} />}
    {selected.reservation.status === "CONVERTED" ? <p className="identity-review__fine">Retained for the tenancy. Each private view is recorded.</p> : <><p className="identity-review__fine">Check the name, photograph, legibility and completeness. Acceptance records your document review; the original and person must still be checked at handover.</p><button className="identity-review__primary" disabled={busy || viewed.length !== selected.pageCount} onClick={() => void review("ACCEPT")}>Accept document</button><label className="identity-review__reason">Reason for replacement<select value={reason} disabled={busy} onChange={event => setReason(event.target.value)}>{reasons.map(value => <option key={value}>{value}</option>)}</select></label><button disabled={busy} onClick={() => void review("REPLACE")}>Request replacement</button></>}</> : <div className="identity-review__notice">This copy is no longer available. {selected.replacementReason} {selected.status === "ACCEPTED" ? "The staff acceptance record is retained." : "A new upload is needed before review."}</div>}</> : <div className="identity-review__empty"><strong>Select a submission</strong><p>Document images only open when you request a private preview. Each view is recorded.</p></div>}</section></div>
  </main>;
}
