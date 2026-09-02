"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { textToQrSvg } from "@/lib/qrcode-svg";

type Status = { enabled: boolean; recoveryCodesRemaining: number };
export function MfaSettings() {
  const [status, setStatus] = useState<Status | null>(null), [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null), [codes, setCodes] = useState<string[]>([]), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const qrSvg = useMemo(() => { if (!setup) return ""; try { return textToQrSvg(setup.uri); } catch { return ""; } }, [setup]);
  async function refresh() { const response = await fetch("/api/auth/mfa"); const payload = await response.json(); if (response.ok) setStatus(payload.data); }
  useEffect(() => {
    let active = true;
    fetch("/api/auth/mfa").then((response) => response.json().then((payload) => ({ ok: response.ok, payload }))).then(({ ok, payload }) => { if (active && ok) setStatus(payload.data); });
    return () => { active = false; };
  }, []);
  async function call(action: string, body: Record<string, unknown> = {}) { setBusy(true); setMessage(""); const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) }); const payload = await response.json(); setBusy(false); if (!response.ok) { setMessage(payload.error ?? "The security setting could not be changed."); return null; } return payload.data; }
  async function begin() { const data = await call("begin"); if (data) { setSetup(data); setCodes([]); setMessage("Scan the QR code below with your authenticator app, then verify one code."); } }
  async function enable(formData: FormData) { const data = await call("enable", { code: formData.get("code") }); if (data) { setCodes(data.recoveryCodes); setSetup(null); setStatus({ enabled: true, recoveryCodesRemaining: data.recoveryCodes.length }); setMessage("Two-step verification is enabled. Save the recovery codes now; they will not be shown again."); } }
  async function regenerate(formData: FormData) { const data = await call("regenerate", { code: formData.get("code") }); if (data) { setCodes(data.recoveryCodes); await refresh(); setMessage("New recovery codes created. All previous codes are now invalid."); } }
  async function disable(formData: FormData) { const data = await call("disable", { code: formData.get("code"), password: formData.get("password") }); if (data) window.location.assign("/login"); }
  if (!status) return <p className="panel-subtitle">Loading account security…</p>;
  return <div className="mfa-settings"><div className={`mfa-status ${status.enabled ? "is-enabled" : ""}`}><ShieldCheck size={20}/><div><strong>{status.enabled ? "Two-step verification is on" : "Two-step verification is off"}</strong><p>{status.enabled ? `${status.recoveryCodesRemaining} unused recovery codes remain.` : "Add an authenticator app before requiring a second step at sign-in."}</p></div></div>
    {!status.enabled && !setup ? <button className="button button-primary" disabled={busy} onClick={begin}>Set up authenticator</button> : null}
    {setup ? <form className="mfa-setup" action={enable}><style>{".mfa-qr{display:flex;justify-content:center;padding:16px;border:1px solid var(--line);border-radius:10px;background:#fff}.mfa-qr svg{width:176px;height:176px}"}</style><p><strong>1. Scan this QR code</strong></p><p>Open Microsoft Authenticator, Google Authenticator, 1Password or a similar app and scan the code below to add this account.</p>{qrSvg ? <div className="mfa-qr" role="img" aria-label="Authenticator QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <p className="panel-subtitle">Generating QR code…</p>}<details><summary>Can&apos;t scan? Enter the setup key manually</summary><div className="mfa-secret"><code>{setup.secret}</code><button type="button" aria-label="Copy setup key" onClick={() => navigator.clipboard.writeText(setup.secret)}><Copy size={16}/></button></div><div className="mfa-uri"><code>{setup.uri}</code></div></details><label><strong>2. Verify the 6-digit code</strong><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label><button className="button button-primary" disabled={busy} type="submit">Verify and enable</button></form> : null}
    {status.enabled ? <div className="mfa-actions"><form action={regenerate}><label>Authenticator or recovery code<input name="code" autoComplete="one-time-code" required /></label><button className="button" disabled={busy} type="submit">Create new recovery codes</button></form><form action={disable}><label>Current password<input name="password" type="password" autoComplete="current-password" required /></label><label>Authenticator or recovery code<input name="code" autoComplete="one-time-code" required /></label><button className="button button-danger" disabled={busy} type="submit">Turn off two-step verification</button></form></div> : null}
    {codes.length ? <div className="recovery-codes"><div><strong>Recovery codes — shown once</strong><button type="button" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}><Copy size={16}/> Copy all</button></div><pre>{codes.join("\n")}</pre></div> : null}{message ? <p className="form-message" role="status">{message}</p> : null}</div>;
}
