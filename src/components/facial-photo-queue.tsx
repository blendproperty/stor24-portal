"use client";
/* eslint-disable @next/next/no-img-element -- Private blob previews must not enter the shared image optimiser. */
import "@/styles/facial-access.css";

import { useEffect, useState } from "react";
import { Camera, Check, Clock3, LockKeyhole, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type FacialPhotoRow = { id: string; version: number; status: string; expiresAt: string | null; customerName: string; facilityId: string; facilityName: string; unitNumber: string };
const labels: Record<string, string> = { WAITING_REVIEW: "Awaiting review", APPROVED: "Ready for handover", PENDING_PROVIDER: "Activation pending", EXPIRED: "Expired", WITHDRAWN: "Withdrawn", REJECTED: "New photo needed" };
export function FacialPhotoQueue({ photos, policyConfigured, manageableFacilities }: { photos: FacialPhotoRow[]; policyConfigured: boolean; manageableFacilities: string[] | null }) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ id: string; version: number; url: string; name: string; expiresAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setPreview(null), Math.min(60_000, Math.max(0, (preview.expiresAt ? new Date(preview.expiresAt).getTime() - Date.now() : 60_000))));
    return () => { clearTimeout(timer); URL.revokeObjectURL(preview.url); };
  }, [preview]);
  async function open(photo: FacialPhotoRow) {
    setPreview(null); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/access/photos?${new URLSearchParams({ preview: "true", id: photo.id, version: String(photo.version) })}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error);
      setPreview({ id: photo.id, version: photo.version, url: URL.createObjectURL(await response.blob()), name: photo.customerName, expiresAt: photo.expiresAt });
    } catch (err) { setMessage(err instanceof Error ? err.message : "Photo unavailable. Refresh the queue."); }
    finally { setBusy(false); }
  }
  async function review(photo: FacialPhotoRow, decision: "APPROVE" | "REJECT") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/access/photos?${new URLSearchParams({ id: photo.id, version: String(photo.version), decision })}`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error);
      setMessage(decision === "APPROVE" ? "Photo approved for staff handover. Gate access remains pending." : "Photo rejected and removed. The customer can submit another photograph.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Review could not be saved."); }
    finally { setPreview(null); setBusy(false); router.refresh(); }
  }
  return <section className="face-workspace" aria-label="Private facial photo queue">
    <header className="face-heading"><div><span className="face-eyebrow">MOVE-IN &amp; ACCESS</span><h2>A reviewed photo.<br />A confirmed arrival.</h2><p>Prepare facial access from the customer’s private submission.</p></div><span className="face-pill"><LockKeyhole size={14} /> {policyConfigured ? "Gate activation unavailable" : "Photo collection disabled"}</span></header>
    <div className="face-steps"><article><Camera size={21} /><span>01 · Submit</span><h3>Customer photograph</h3><p>{policyConfigured ? "Customer consent and a verified booking are required." : "Photo collection is off. The owner controls collection using the setting above."}</p></article><article><Check size={21} /><span>02 · Review</span><h3>Staff confirmation</h3><p>Review the photo, then confirm identity and move-in through key handover.</p></article><article><LockKeyhole size={21} /><span>03 · Activate</span><h3>Provider verification</h3><p>Automatic activation from this photo queue is not connected to Hikvision yet. An approved photo does not grant gate access.</p></article></div>
    <div className="face-queue-heading"><div><h3>Photographs awaiting review</h3><p>Private previews close automatically after one minute. Review never opens the gate.</p></div><button className="button button-secondary" disabled={busy} onClick={() => { setPreview(null); router.refresh(); }}>Refresh queue</button></div>
    {message && <p className="face-feedback" role="status">{message}</p>}
    {preview && <aside className="face-preview" aria-label="Private photograph preview"><div><img src={preview.url} alt={`Submitted access photograph for ${preview.name}`} /><p>{preview.name} · Version {preview.version}</p></div><button className="button button-secondary" onClick={() => setPreview(null)}><X size={15} /> Close photograph</button></aside>}
    {photos.length ? <div className="face-rows">{photos.map(photo => {
      const expired = photo.expiresAt !== null && new Date(photo.expiresAt).getTime() <= now, canManage = manageableFacilities === null || manageableFacilities.includes(photo.facilityId);
      const reviewable = !expired && photo.status === "WAITING_REVIEW";
      return <article className="face-row" key={`${photo.id}:${photo.version}`}><div><h4>{photo.customerName}</h4><p>{photo.facilityName} · Unit {photo.unitNumber}</p><small>Version {photo.version} · {photo.expiresAt ? `Retention ends ${formatSouthAfricaDateTime(photo.expiresAt)} SAST` : "Retained during active booking and tenancy"}</small></div><span className="face-row-status">{labels[expired && ["APPROVED", "WAITING_REVIEW", "PENDING_PROVIDER"].includes(photo.status) ? "EXPIRED" : photo.status] ?? "Review required"}</span><div className="face-row-actions">{canManage && reviewable && <><button className="button button-secondary" disabled={busy} onClick={() => void open(photo)}>View privately</button><button className="button button-primary" disabled={busy || preview?.id !== photo.id || preview.version !== photo.version} onClick={() => void review(photo, "APPROVE")}>Approve photo</button><button className="button button-secondary" disabled={busy} onClick={() => void review(photo, "REJECT")}>Request new photo</button></>}</div></article>;
    })}</div> : <div className="face-empty"><Clock3 size={28} /><h3>No customer photographs queued</h3><p>Eligible customers submit through My STOR24 once collection is enabled.</p></div>}
    <footer className="face-footer"><strong>What still needs to be completed</strong><p>Complete the interim policy review, complete and verify the Hikvision activation connection, then test entry, suspension, restoration and removal on site. This page shows setup readiness, not a live gate status.</p></footer>
  </section>;
}
