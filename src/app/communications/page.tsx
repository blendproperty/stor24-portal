import { FileText, Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { SmsTestForm } from "@/components/sms-test-form";
import { WhatsAppTestForm } from "@/components/whatsapp-test-form";
import { getSession } from "@/lib/session";

export const metadata = { title: "Communications" };

const templates = [
  ["lead-follow-up", "Lead follow-up", "Email", "Draft", "Lead name, facility, requested unit, follow-up link"],
  ["payment-receipt", "Payment receipt", "Email", "Draft", "Receipt number, amount, payment date, account balance"],
  ["past-due-reminder", "Past-due reminder", "Email / SMS", "Draft", "Balance, due date, facility contact, payment link"],
  ["move-in-welcome", "Move-in welcome", "Email", "Draft", "Unit, access guidance, agreement link, facility hours"],
] as const;

export default async function CommunicationsPage() {
  const session = await getSession();
  const smsConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
  const whatsAppConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
  return <div className="page-stack">
    <PageHeader eyebrow="Customer engagement" title="Communications" description="Versioned templates, provider status and privacy-safe delivery controls for email and SMS." />
    <section className="summary-strip"><div className="summary-cell"><span>Active templates</span><strong>0</strong></div><div className="summary-cell"><span>Draft templates</span><strong>4</strong></div><div className="summary-cell"><span>Queued</span><strong>0</strong></div><div className="summary-cell"><span>Failed</span><strong>0</strong></div></section>
    <section className="panel"><div className="panel-heading panel-spacious"><div><h2>Template library</h2><p className="panel-subtitle">Template variables are explicit and versions are immutable after use.</p></div><FileText className="muted-icon" /></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Key</th><th>Template</th><th>Channel</th><th>Status</th><th>Variables</th></tr></thead><tbody>{templates.map(([key, name, channel, status, variables]) => <tr key={key}><td><code>{key}</code></td><td className="primary-cell">{name}</td><td>{channel === "Email" ? <><Mail size={14} /> {channel}</> : <><MessageSquareText size={14} /> {channel}</>}</td><td><StatusPill tone="warning">{status}</StatusPill></td><td>{variables}</td></tr>)}</tbody></table></div></section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Twilio SMS connection test</h2><p className="panel-subtitle">Send one controlled test without creating customer or reservation records.</p></div><StatusPill tone={smsConfigured ? "positive" : "warning"}>{smsConfigured ? "Configured" : "Configuration required"}</StatusPill></div>{smsConfigured && session?.role === "Organisation owner" ? <SmsTestForm /> : <div className="empty-state"><strong>{smsConfigured ? "Owner access required" : "Twilio SMS is not configured"}</strong><p>{smsConfigured ? "Only the organisation owner can send provider connection tests." : "Add the server-only sender identity and credentials before testing."}</p></div>}</section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Twilio WhatsApp connection test</h2><p className="panel-subtitle">Send one controlled test without enabling automatic customer messaging.</p></div><StatusPill tone={whatsAppConfigured ? "positive" : "warning"}>{whatsAppConfigured ? "Configured" : "Configuration required"}</StatusPill></div>{whatsAppConfigured && session?.role === "Organisation owner" ? <WhatsAppTestForm /> : <div className="empty-state"><strong>{whatsAppConfigured ? "Owner access required" : "Twilio WhatsApp is not configured"}</strong><p>{whatsAppConfigured ? "Only the organisation owner can send provider connection tests." : "Add the approved server-only WhatsApp sender before testing."}</p></div>}</section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Delivery log</h2><p className="panel-subtitle">Recipient values are stored as hashes; provider references and failures are auditable.</p></div><ShieldCheck className="positive-icon" /></div><div className="empty-state"><strong>No customer delivery attempts</strong><p>Reservation notifications appear here after the delivery-log interface is connected to its stored records.</p></div></section>
  </div>;
}
