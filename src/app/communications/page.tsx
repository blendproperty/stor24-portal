import { FileText, Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { SmsTestForm } from "@/components/sms-test-form";
import { WhatsAppTestForm } from "@/components/whatsapp-test-form";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { WhatsAppRetryButton } from "@/components/whatsapp-retry-button";
import { requirePermission } from "@/lib/auth-guards";

export const metadata = { title: "Communications" };

const templates = [
  ["lead-follow-up", "Lead follow-up", "Email", "Draft", "Lead name, facility, requested unit, follow-up link"],
  ["payment-receipt", "Payment receipt", "Email", "Draft", "Receipt number, amount, payment date, account balance"],
  ["past-due-reminder", "Past-due reminder", "Email / SMS", "Draft", "Balance, due date, facility contact, payment link"],
  ["move-in-welcome", "Move-in welcome", "Email", "Draft", "Unit, access guidance, agreement link, facility hours"],
] as const;

export default async function CommunicationsPage() {
  const session = await getSession();
  const scope = await requirePermission("operations.view");
  const smsConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
  const whatsAppConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.TWILIO_WHATSAPP_TEST_CONTENT_SID);
  const logs = await db.communicationLog.findMany({ where: { organisationId: scope.organisationId, channel: "WHATSAPP", ...(scope.allowedFacilityIds ? { OR: [{ facilityId: null }, { facilityId: { in: scope.allowedFacilityIds } }] } : {}) }, include: { customer: { select: { firstName: true, lastName: true, companyName: true } }, facility: { select: { name: true } } }, orderBy: { queuedAt: "desc" }, take: 100 });
  const failed = logs.filter((item) => item.status === "FAILED").length;
  const pending = logs.filter((item) => ["PENDING", "PROCESSING"].includes(item.status)).length;
  return <div className="page-stack">
    <PageHeader eyebrow="Customer engagement" title="Communications" description="Approved templates, provider status, consent and privacy-safe delivery controls for email, SMS and WhatsApp." />
    <section className="summary-strip"><div className="summary-cell"><span>WhatsApp attempts</span><strong>{logs.length}</strong></div><div className="summary-cell"><span>Queued / sending</span><strong>{pending}</strong></div><div className="summary-cell"><span>Delivered / read</span><strong>{logs.filter((item) => item.deliveredAt).length}</strong></div><div className="summary-cell"><span>Failed</span><strong>{failed}</strong></div></section>
    <section className="panel"><div className="panel-heading panel-spacious"><div><h2>Template library</h2><p className="panel-subtitle">Template variables are explicit and versions are immutable after use.</p></div><FileText className="muted-icon" /></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Key</th><th>Template</th><th>Channel</th><th>Status</th><th>Variables</th></tr></thead><tbody>{templates.map(([key, name, channel, status, variables]) => <tr key={key}><td><code>{key}</code></td><td className="primary-cell">{name}</td><td>{channel === "Email" ? <><Mail size={14} /> {channel}</> : <><MessageSquareText size={14} /> {channel}</>}</td><td><StatusPill tone="warning">{status}</StatusPill></td><td>{variables}</td></tr>)}</tbody></table></div></section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Twilio SMS connection test</h2><p className="panel-subtitle">Send one controlled test without creating customer or reservation records.</p></div><StatusPill tone={smsConfigured ? "positive" : "warning"}>{smsConfigured ? "Configured" : "Configuration required"}</StatusPill></div>{smsConfigured && session?.role === "Organisation owner" ? <SmsTestForm /> : <div className="empty-state"><strong>{smsConfigured ? "Owner access required" : "Twilio SMS is not configured"}</strong><p>{smsConfigured ? "Only the organisation owner can send provider connection tests." : "Add the server-only sender identity and credentials before testing."}</p></div>}</section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Twilio WhatsApp connection test</h2><p className="panel-subtitle">Send one controlled test without enabling automatic customer messaging.</p></div><StatusPill tone={whatsAppConfigured ? "positive" : "warning"}>{whatsAppConfigured ? "Configured" : "Configuration required"}</StatusPill></div>{whatsAppConfigured && session?.role === "Organisation owner" ? <WhatsAppTestForm /> : <div className="empty-state"><strong>{whatsAppConfigured ? "Owner access required" : "Twilio WhatsApp is not configured"}</strong><p>{whatsAppConfigured ? "Only the organisation owner can send provider connection tests." : "Add the approved server-only WhatsApp sender before testing."}</p></div>}</section>
    <section className="panel"><div className="panel-heading panel-spacious"><div><h2>WhatsApp delivery log</h2><p className="panel-subtitle">Recipient values are stored as hashes. Twilio callbacks update sent, delivered, read and failed timestamps.</p></div><ShieldCheck className="positive-icon" /></div>{logs.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Facility</th><th>Message</th><th>Direction</th><th>Status</th><th>Updated</th><th>Failure</th><th></th></tr></thead><tbody>{logs.map((item) => <tr key={item.id}><td className="primary-cell">{item.customer?.companyName || [item.customer?.firstName,item.customer?.lastName].filter(Boolean).join(" ") || "Unknown"}</td><td>{item.facility?.name || "—"}</td><td>{item.messageType || "—"}</td><td>{item.direction}</td><td><StatusPill tone={item.status === "FAILED" ? "warning" : item.deliveredAt ? "positive" : "neutral"}>{item.readAt ? "READ" : item.deliveredAt ? "DELIVERED" : item.sentAt ? "SENT" : item.status}</StatusPill></td><td>{new Date(item.readAt || item.deliveredAt || item.sentAt || item.queuedAt).toLocaleString("en-ZA")}</td><td>{item.failureCode || "—"}</td><td>{item.status === "FAILED" && item.direction === "OUTBOUND" ? <WhatsAppRetryButton logId={item.id}/> : null}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No WhatsApp delivery attempts</strong><p>Approved-template customer messages will appear here.</p></div>}</section>
  </div>;
}
