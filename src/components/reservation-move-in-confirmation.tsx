"use client";

import { southAfricaDateKey } from "@/lib/south-africa-time";
import { MoveInProgressNav } from "./move-in-progress-nav";
import type { MoveInProgress } from "@/lib/move-in-progress";
import { ReservationPaymentForm } from "./reservation-payment-form";
import { useState } from "react";
import { FileCheck2, Wallet, CalendarDays, ArrowUpRight, CircleAlert, KeyRound, Check, ShieldCheck, Camera, Warehouse } from "lucide-react";
import type { ReservationMoveInReadiness } from "@/lib/reservation-move-in";
import { confirmReservationMoveInAction } from "@/app/actions/leasing";

export function ReservationMoveInConfirmation({ reservationId, customerName, unitNumber, readiness, canRecordPayment = false, canReviewIdentity = false, canReviewPhoto = false, progress, onBack }: {
  progress?: MoveInProgress; canReviewPhoto?: boolean; canReviewIdentity?: boolean; canRecordPayment?: boolean; reservationId: string; customerName: string; unitNumber: string; readiness: ReservationMoveInReadiness; onBack: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (amount: number) => `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
  const moveInDate = readiness.startDate ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(`${readiness.startDate}T12:00:00+02:00`)) : "Not recorded";
  const handedOver = progress?.handedOver ?? false;
  const identityDone = Boolean(progress?.identityAccepted || handedOver);
  const overdue = Boolean(readiness.startDate && readiness.startDate < southAfricaDateKey(new Date()) && !handedOver);
  const photoDone = progress?.photoReviewed ?? false;
  const identityLabel = identityDone ? progress?.identityAccepted ? "Accepted" : "Checked at handover" : progress?.identityStatus === "REPLACEMENT_REQUIRED" ? "Replacement needed" : progress?.identityStatus === "AWAITING_REVIEW" ? "Awaiting review" : "Check required";
  const photoLabel = photoDone ? "Reviewed" : progress?.photoStatus === "WAITING_REVIEW" ? "Awaiting review" : progress?.photoCollectionEnabled ? "Capture needed" : "Collection on hold";
  return <><MoveInProgressNav steps={[
    { label: "Select unit", icon: Warehouse, status: `Unit ${unitNumber} selected`, complete: true, onClick: onBack },
    { label: "Agreement", icon: FileCheck2, status: readiness.signed ? "Signed" : "Not signed", complete: readiness.signed, blocked: overdue, href: "#move-in-agreement" },
    { label: "Payment", icon: Wallet, status: readiness.paymentVerified ? "Verified" : readiness.testPayment ? "Test payment only" : "Record payment", complete: readiness.paymentVerified, blocked: readiness.testPayment || overdue, href: "#move-in-payment" },
    { label: "Check ID", icon: ShieldCheck, status: identityLabel, complete: identityDone, blocked: overdue || ["REPLACEMENT_REQUIRED", "EXPIRED", "WITHDRAWN"].includes(progress?.identityStatus ?? ""), href: "#move-in-identity" },
    { label: "Access photo", icon: Camera, status: photoLabel, complete: photoDone, blocked: overdue || !progress?.photoCollectionEnabled || ["EXPIRED", "WITHDRAWN", "REJECTED"].includes(progress?.photoStatus ?? ""), href: "#move-in-photo" },
    { label: "Hand over keys", icon: KeyRound, status: handedOver ? "Recorded" : readiness.ready ? "Ready to record" : "Checks outstanding", complete: handedOver, blocked: !readiness.ready, href: "#move-in-keys" },
  ]} /><section className="handover-workspace" aria-label="Booking handover checks">
    <header className="handover-heading">
      <div><p className="handover-eyebrow">BOOKING HANDOVER</p><h2>{handedOver ? "Key handover recorded" : readiness.ready ? "Ready for key collection" : "Move-in checks"}</h2><p className="handover-customer">{customerName}<span>Unit {unitNumber}</span></p></div>
      <span className={`handover-status ${handedOver || readiness.ready ? "is-ready" : "is-pending"}`}>{handedOver || readiness.ready ? <Check size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}{handedOver ? "Handover complete" : readiness.ready ? "Ready to move in" : "Action required"}</span>
    </header>
    <div className="handover-checks" data-guide="handover-checks">
      <section id="move-in-agreement" tabIndex={-1} className="handover-check" data-guide="handover-agreement"><div className="handover-check-label"><FileCheck2 size={19} aria-hidden="true" /><span>02 · Agreement</span></div><h3>{readiness.signed ? "Agreement signed" : "Agreement needs review"}</h3>{!readiness.signed && <p>Review the agreement before handing over keys.</p>}{readiness.leaseId && readiness.signed && <a className="handover-document" href={`/api/v1/public-leases/${readiness.leaseId}/signed-pdf`}>View signed agreement <ArrowUpRight size={15} aria-hidden="true" /></a>}</section>
      <section id="move-in-payment" tabIndex={-1} className="handover-check"><div className="handover-check-label"><Wallet size={19} aria-hidden="true" /><span>03 · Payment</span></div><h3>{readiness.paymentVerified ? "Payment verified" : "Payment confirmation needed"}</h3><p className="handover-amount">{money(readiness.paidAmount)} <span>verified</span></p><p>of {money(readiness.requiredAmount)} required for this booking</p>{readiness.testPayment && <span className="handover-test-label">Sandbox payment on file</span>}{canRecordPayment && !readiness.paymentVerified && !handedOver && <ReservationPaymentForm reservationId={reservationId} />}</section>
      <section className="handover-check"><div className="handover-check-label"><CalendarDays size={19} aria-hidden="true" /><span>Move-in date</span></div><h3>{moveInDate}</h3><p>Key collection is available from the agreed start date, once all checks are complete.</p></section>
    </div>
    {!handedOver && readiness.blockers.length > 0 && <aside className="handover-notice" role="status"><CircleAlert size={20} aria-hidden="true" /><div><h3>Before keys can be released</h3><ul>{readiness.blockers.map(blocker => <li key={blocker}>{blocker.replace(/\b\d{4}-\d{2}-\d{2}\b/g, value => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(`${value}T12:00:00+02:00`)))}</li>)}</ul></div></aside>}
    {readiness.mandateStatus && <div className="handover-mandate"><h3>Debit-order mandate <span>{readiness.mandateStatus.replaceAll("_", " ")}</span></h3><p>A mandate is not a payment. Collections are not enabled; verify the first payment separately.</p></div>}
    <div className="move-in-review-grid">
      <section id="move-in-identity" tabIndex={-1} className="handover-check"><div className="handover-check-label"><ShieldCheck size={19} aria-hidden="true" /><span>04 · Check ID</span></div><h3>{progress?.identityAccepted ? "Identity document accepted" : identityDone ? "Identity checked at handover" : identityLabel}</h3><p>{progress?.identityAccepted ? "Staff acceptance is saved. Match the original document and the person at key collection." : handedOver ? "The staff handover confirmation records that the customer’s identity was checked." : "Open the booking’s submission, check every page and save the review decision."}</p>{canReviewIdentity && <a className={`button ${identityDone ? "button-secondary" : "button-primary"}`} href={`/identity?reservation=${encodeURIComponent(reservationId)}`}>{identityDone ? "View ID review" : "Review ID"}</a>}{!canReviewIdentity && <p>An authorised ID reviewer must complete this step.</p>}</section>
      <section id="move-in-photo" tabIndex={-1} className="handover-check"><div className="handover-check-label"><Camera size={19} aria-hidden="true" /><span>05 · Access photo</span></div><h3>{photoDone ? "Access photo reviewed" : photoLabel}</h3><p>{photoDone ? "The photo is saved and reviewed." : progress?.photoCollectionEnabled ? "Capture the customer’s access photo with their consent, then complete staff review." : "Photo collection is awaiting approved consent and retention settings."}</p>{progress?.photoCollectionEnabled && progress.publicReference && <a className="button button-primary" href={`/my?booking=${encodeURIComponent(progress.publicReference)}&step=access-photo`} target="_blank" rel="noopener noreferrer">Open customer photo capture</a>}{canReviewPhoto && <a className={`button ${photoDone ? "button-secondary" : "button-primary"}`} href={`/access?reservation=${encodeURIComponent(reservationId)}`}>Review access photo</a>}<p className="move-in-provider-note">Photo capture and review do not confirm that Hikvision access is active.</p></section>
    </div>
    <section id="move-in-keys" tabIndex={-1}>
    {handedOver && <div className="handover-notice" role="status"><Check size={20} aria-hidden="true" /><div><h3>Keys handed over — confirmation saved</h3><p>{progress?.handedOverAt ? new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(new Date(progress.handedOverAt)) : "Recorded by staff"}</p><a className="button button-secondary" href="/operations/accounts">Open accounts</a></div></div>}

    <div className="handover-key-note"><KeyRound size={20} aria-hidden="true" /><div><h3>06 · Hand over keys</h3><p>Match the customer to their original ID and confirm the unit before recording key collection.</p></div></div>
    {!handedOver && <form action={async data => {
      setBusy(true); setError("");
      try { const result = await confirmReservationMoveInAction(data); if (result?.error) setError(result.error); }
      finally { setBusy(false); }
    }}>
      <input type="hidden" name="reservationId" value={reservationId} />
      {readiness.ready && <label className="handover-attestation"><input type="checkbox" name="handoverConfirmed" required disabled={busy} /> I have checked the customer identity and am handing over the keys for this unit.</label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="handover-actions" data-guide="handover-actions">
        <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="button button-secondary" onClick={() => window.location.assign(`/operations/move-in?reservation=${encodeURIComponent(reservationId)}`)} disabled={busy}>Refresh checks</button>
        <button className="button button-primary" disabled={!readiness.ready || busy}>{busy ? "Recording handover…" : "Confirm move-in / key handover"}</button>
      </div>
    </form>}
    </section>
  </section></>;
}
