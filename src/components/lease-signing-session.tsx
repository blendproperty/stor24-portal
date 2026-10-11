"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";

type Session = {
  accountId: string; reservationId: string | null; leadId: string | null;
  completed: boolean; reconciling?: boolean; dispatchRequired?: boolean;
  paymentMethod?: string | null; mandate?: { status: string; signedPdfSha256: string | null } | null;
  signers: { name: string; order: number; status: string; signingUrl: string | null }[];
};

export function LeaseSigningSession({ documentId }: { documentId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [mandateUrl, setMandateUrl] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!documentId) { setError("Choose the saved lease from its account."); return; }
    setBusy(true); setError(""); setCopied(false); setMandateUrl(null);
    try {
      const response = await fetch(`/api/v1/documents/${encodeURIComponent(documentId)}/signing-session`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Signing is unavailable. Retry or review the saved account.");
      setSession(payload.data);
    } catch (error) {
      setSession(null); // Never leave a stale signing link available after a failed refresh.
      setError(error instanceof Error ? error.message : "Signing status could not be loaded.");
    } finally { setBusy(false); }
  }, [documentId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("The link could not be copied. Open signing on the customer's device or use email follow-up."); }
  }
  async function prepare() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/documents/${encodeURIComponent(documentId)}/signing-session`, { method: "POST" });
      if (!response.ok) throw new Error("Signing could not be prepared. The saved account is retained; retry or ask an authorised manager to review the integration.");
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Signing could not be prepared."); }
    finally { setBusy(false); }
  }
  async function prepareMandate() {
    setBusy(true); setError(""); setMandateUrl(null);
    try {
      const response = await fetch(`/api/v1/documents/${encodeURIComponent(documentId)}/mandate-session`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.data?.setupUrl) throw new Error("The separate debit-order mandate could not be prepared. Check the signed lease, customer and account terms before retrying.");
      setMandateUrl(payload.data.setupUrl);
    } catch (error) { setError(error instanceof Error ? error.message : "Mandate setup is unavailable."); }
    finally { setBusy(false); }
  }
  const signer = session?.signers.find(s => s.signingUrl);
  return <div className="page-stack">
    <PageHeader eyebrow="Lead to lease" title={session?.completed ? "Lease agreement signed" : "Review and sign now"}
      description="Complete agreement review and signing during the visit or call, then continue with this customer's account." />
    <section className="panel lease-signing-panel" aria-label="Agreement signing session" data-guide="assisted-signing">
      <p>For a walk-in, let the customer review, initial and sign on the counter device. For a phone-in, share the customer signing link and stay on the call. The customer provides their own acceptance and signature.</p>
      <p>After customer signing, the authorised representative completes their signing step if required. BlendSign sends the completed agreement afterwards.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {session?.dispatchRequired && <p role="status">The lease and account are saved, but signing could not be prepared. Retry signing preparation for this saved lease.</p>}
      {session?.reconciling && <p role="status">BlendSign has completed signing. Waiting for the saved document confirmation; refresh before continuing.</p>}
      {session?.signers.map(s => <p key={s.order}>{s.name}: {s.status.replaceAll("_", " ")}</p>)}
      <div className="form-actions">
        {session?.dispatchRequired && <button type="button" className="button button-primary" disabled={busy} onClick={() => void prepare()}>Prepare signing for saved lease</button>}
        {!busy && signer?.signingUrl && <>
          <a className="button button-primary" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" href={signer.signingUrl}>Open signing for {signer.name}</a>
          <button type="button" className="button button-secondary" onClick={() => void copyLink(signer.signingUrl!)}>Copy signing link for phone-in</button>
        </>}
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>{busy ? "Checking signing status..." : "Refresh signing status"}</button>
      </div>
      {copied && <p role="status">Signing link copied. Share it with this signer during the call.</p>}
      {session?.completed && <p role="status">The signed agreement is saved. Continue with payment and move-in checks; signing does not confirm payment or key handover.</p>}
      {session?.completed && session.paymentMethod === "DEBIT_ORDER" && <section className="form-section" aria-label="Separate debit-order mandate">
        <h2>Complete the separate debit-order mandate</h2>
        <p>The storage agreement is signed. The customer must also review the debit amount, schedule and bank authority, enter their bank details securely with Netcash, and sign the mandate using their own OTP.</p>
        <p role="status">{session.mandate?.status === "SIGNED" ? session.mandate.signedPdfSha256 ? "Mandate confirmed and signed PDF attached. Payment and move-in checks remain separate." : "Mandate signed; signed PDF attachment is still pending." : "Bank mandate not yet confirmed. The storage agreement PDF is not the bank mandate."}</p>
        <button className="button button-primary" disabled={busy} onClick={() => void prepareMandate()}>Prepare customer mandate signing</button>
        {mandateUrl && <div className="form-actions"><a className="button button-primary" href={mandateUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open customer mandate on this device</a><button className="button button-secondary" onClick={() => void copyLink(mandateUrl)}>Copy mandate link for customer&apos;s phone</button></div>}
      </section>}
      <div className="form-actions">
        {session && <a className="button button-secondary" href={`/operations/accounts?accountId=${encodeURIComponent(session.accountId)}`}>{session.completed ? "Continue to payment and account" : "Review saved account"}</a>}
        {session?.leadId && <a className="button button-secondary" href={`/leads?lead=${encodeURIComponent(session.leadId)}`}>Back to enquiry journey</a>}
        {session?.dispatchRequired && <a className="button button-secondary" href="/integrations">Review signing dispatch</a>}
        {!session && <a className="button button-secondary" href={`/operations/accounts?documentId=${encodeURIComponent(documentId)}`}>Review saved account</a>}
      </div>
    </section>
  </div>;
}
