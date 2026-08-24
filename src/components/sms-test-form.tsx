"use client";
import { useState } from "react";
import { Send } from "lucide-react";

export function SmsTestForm() {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [success, setSuccess] = useState(false);
  async function submit(formData: FormData) {
    setBusy(true); setMessage(""); setSuccess(false);
    const response = await fetch("/api/v1/communications/test-sms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient: formData.get("recipient") }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(payload.error ?? "The test SMS could not be sent."); return; }
    setSuccess(true); setMessage("Test SMS queued successfully. Confirm it arrives on the destination phone.");
  }
  return <form action={submit} className="sms-test-form"><label><span>South African test number</span><input name="recipient" type="tel" inputMode="tel" placeholder="+27821234567" pattern="\+27[1-9][0-9]{8}" required /></label><p className="panel-subtitle">Owner-only test. The number is not stored; the audit trail records only a privacy-safe hash.</p><button className="button button-primary" disabled={busy} type="submit"><Send size={16}/>{busy ? "Sending…" : "Send test SMS"}</button>{message ? <p className={success ? "form-success" : "form-error"} role="status">{message}</p> : null}</form>;
}
