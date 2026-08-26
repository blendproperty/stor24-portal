"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, ShieldCheck } from "lucide-react";

export function WhatsAppAutomationControl({ enabled, serverGateEnabled, configured, canManage }: { enabled: boolean; serverGateEnabled: boolean; configured: boolean; canManage: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState(enabled), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const ready = serverGateEnabled && configured;
  async function update(next: boolean) {
    if (next && !confirm("Enable automatic WhatsApp messages for customers who have explicitly consented?")) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/v1/integrations/whatsapp-automation", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "WhatsApp automation could not be updated."); return; }
    setActive(payload.data.enabled); setMessage(next ? "Automatic WhatsApp customer messages are enabled." : "Automatic WhatsApp customer messages are disabled."); router.refresh();
  }
  return <section className="panel panel-spacious whatsapp-automation-card">
    <div className="panel-heading"><div><p className="eyebrow">Twilio WhatsApp</p><h2>Automatic customer messages</h2><p className="panel-subtitle">Controls consent-based reservation and customer lifecycle messages.</p></div><MessageCircle className={active ? "positive-icon" : "muted-icon"}/></div>
    <div className="whatsapp-automation-state"><span className={active ? "integration-state-dot active" : "integration-state-dot"}/><div><strong>{active ? "Enabled" : "Disabled"}</strong><small>{ready ? "Provider, templates and production safety gate are ready." : "Production configuration is not ready for automatic sending."}</small></div></div>
    <label className="check-label"><input type="checkbox" checked={active} disabled={!canManage || busy || (!active && !ready)} onChange={(event) => void update(event.target.checked)}/><span>{busy ? "Updating…" : "Enable automatic WhatsApp messages"}</span></label>
    {!canManage ? <p className="safe-config-note"><ShieldCheck size={16}/>Only the Organisation Owner can change this control.</p> : null}
    {!serverGateEnabled ? <p className="safe-config-note"><ShieldCheck size={16}/>The production safety gate is disabled. Customer automation cannot be enabled until the approved server configuration is applied.</p> : null}
    {!configured ? <p className="safe-config-note"><ShieldCheck size={16}/>The sender and reservation template must be configured before automation can be enabled.</p> : null}
    {message ? <p className={message.includes("could not") ? "form-error" : "form-success"} role="status">{message}</p> : null}
  </section>;
}
