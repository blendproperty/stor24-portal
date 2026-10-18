"use client";
import { useEffect, useState } from "react";
import type { previewPhoneNotice } from "@/lib/collection-phone-service";
type Preview = Awaited<ReturnType<typeof previewPhoneNotice>>;
type Account = { id: string; accountNumber: string; name: string; facility: string };
const endpoint = "/api/v1/collections/phone-notices";
export function CollectionPhoneWorkspace() {
  const [accounts, setAccounts] = useState<Account[]>([]), [accountId, setAccountId] = useState(""), [channel, setChannel] = useState<"SMS" | "WHATSAPP">("SMS");
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [reference, setReference] = useState(""), [confirm, setConfirm] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => { const abort = new AbortController();
    fetch("/api/v1/collections", { cache: "no-store", signal: abort.signal }).then(async r => { const v = await r.json(); if (!r.ok) throw Error(v.error); setAccounts(v.rows); const requested = new URLSearchParams(window.location.search).get("account"); if (v.rows.some((a: Account) => a.id === requested)) setAccountId(requested!); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => { if (!accountId) return;
    const abort = new AbortController();
    fetch(`${endpoint}?${new URLSearchParams({ accountId, channel })}`, { cache: "no-store", signal: abort.signal }).then(async r => { const v = await r.json(); if (!r.ok) throw Error(v.error); if (!abort.signal.aborted) setPreview(v); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [accountId, channel, reloadToken]);
  function resetPreview() { setPreview(null); setConfirm(false); setReference(""); setError(""); }
  async function act(action: "prepare" | "approve" | "cancel" | "send") {
    if (!preview || busy) return; setBusy(true); setError(""); setConfirm(false);
    try { const saved = preview.notice; const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, accountId, channel, ...(action === "prepare" ? { fingerprint: preview.source.fingerprint } : { id: saved?.id, revision: saved?.revision }), ...(["approve", "cancel"].includes(action) ? { reference } : {}), ...(action === "send" ? { confirm: true } : {}) }) }); const value = await r.json(); if (!r.ok) throw Error(value.error); setPreview(value); }
    catch (e) { if (action === "send") { setPreview(null); setError("The send outcome needs review. Reload this notice to see its saved status; do not send it again."); } else setError(e instanceof Error ? e.message : "Unable to save. Reload before retrying."); }
    finally { setBusy(false); }
  }
  const saved = preview?.notice, payload = saved ?? preview?.message, held = !preview || !!preview.blockers.length, stale = !!saved && !saved.sourceCurrent;
  return <div className="collection-notices" aria-busy={busy}>
    <header className="notice-heading"><h1>Reviewed SMS &amp; WhatsApp reminders</h1><p>1. Select an account and channel. 2. Review the complete reminder. 3. Another authorised colleague approves. 4. Authorise one send.</p><a href="/collections">Back to Collections</a></header>
    <section className="notice-panel"><p>These are payment reminders. They do not satisfy a separately required access-restriction notice, add fees, approve finance or change access.</p>
      <label>Account<select aria-label="Account" disabled={busy} value={accountId} onChange={e => { resetPreview(); setAccountId(e.target.value); }}><option value="">Choose an account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} · {a.name} · {a.facility}</option>)}</select></label>
      <label>Channel<select aria-label="Channel" disabled={busy} value={channel} onChange={e => { resetPreview(); setChannel(e.target.value as typeof channel); }}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></label>
      <button disabled={busy || !accountId} onClick={() => { resetPreview(); setReloadToken(v => v + 1); }}>Reload notice</button>
    </section>
    {error && <p role="alert" className="notice-error">{error}</p>}
    {preview && <><section className="notice-panel"><h2>Recipient and full message</h2><p>{preview.source.accountNumber} · {preview.source.facility} · {preview.source.asOf} SAST</p>
      {preview.blockers.length > 0 && <ul className="notice-error">{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {payload && <><p>Recipient: <strong>{payload.recipient}</strong> · {payload.channel}</p><pre className="notice-preview">{payload.text}</pre></>}
      {stale && saved && ["DRAFT", "APPROVED"].includes(saved.status) && <p className="notice-error">The source, consent or provider template changed. Cancel the unattempted notice and prepare a fresh draft for independent review.</p>}
      {preview.canManage && (!saved || ["DRAFT", "CANCELLED"].includes(saved.status)) && <button disabled={busy || held} onClick={() => act("prepare")}>Prepare / refresh draft</button>}
    </section>
    {saved && <section className="notice-panel"><h2>Review and delivery · {saved.status.replaceAll("_", " ")}</h2>
      {saved.approvedAt && <p>Approved {new Date(saved.approvedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })} SAST · {saved.reference}</p>}
      {preview.canManage && ["DRAFT", "APPROVED"].includes(saved.status) && <><label>Review / cancellation reference<input maxLength={240} value={reference} disabled={busy} onChange={e => setReference(e.target.value)}/></label><div className="notice-actions">
        {saved.status === "DRAFT" && <button disabled={busy || held || stale || !saved.canApprove || reference.trim().length < 3} onClick={() => act("approve")}>Approve reviewed reminder</button>}
        <button disabled={busy || reference.trim().length < 3} onClick={() => act("cancel")}>Cancel unattempted notice</button>
      </div>{!saved.canApprove && <p>A different authorised colleague must approve. Preparing or refreshing the draft cannot approve it.</p>}</>}
      {saved.status === "APPROVED" && preview.canSend && <><label className="notice-confirm"><input type="checkbox" checked={confirm} disabled={busy} onChange={e => setConfirm(e.target.checked)}/>I reviewed this recipient and full message and authorise this single send now.</label><button disabled={busy || held || stale || !confirm || !preview.sendConfigured} onClick={() => act("send")}>Send approved {channel === "SMS" ? "SMS" : "WhatsApp reminder"}</button></>}
      {!preview.sendConfigured && <p>Arrears sending on this channel is off. Separate owner activation and provider configuration are required.</p>}
      {saved.status === "ACCEPTED" && <p>Accepted by the provider. Delivery/read status is separate and appears in customer history. This notice cannot be sent again.</p>}
      {["SENDING", "REVIEW_REQUIRED"].includes(saved.status) && <p className="notice-error">This attempt is held for delivery review. Check provider evidence; no automatic retry or fallback channel is permitted.</p>}
      <p>Prepared text, review and attempt evidence are retained. Communication bodies and PDF/CSV/Excel downloads keep the existing Collections access checks.</p>
    </section>}</>}
  </div>;
}
