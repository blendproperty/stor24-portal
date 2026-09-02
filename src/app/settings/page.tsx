import { BadgePercent, Building2, Cable, FileSignature, KeyRound, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ChangePasswordForm } from "@/components/change-password-form";
import Link from "next/link";
import { MfaSettings } from "@/components/mfa-settings";

export const metadata = { title: "Settings" };

const modules = [
  [Building2, "Organisation & facilities", "Portfolio hierarchy, facilities, buildings, zones and operating hours.", "/company"],
  [ShieldCheck, "Users & permissions", "Scoped roles, approval thresholds and report access.", "/users"],
  [BadgePercent, "Rates & billing rules", "Rate plans, fees, deposits, tax, discounts and collection policies.", "/company"],
  [FileSignature, "Documents & templates", "Agreements, notices, invoices, receipts and communication templates.", "/company"],
  [KeyRound, "Hikvision access control", "Secure OpenAPI credentials, facility mapping and access lifecycle rules.", "/settings/integrations/hikvision"],
  [Cable, "Integrations & webhooks", "Payments, messaging, accounting, e-signature and partner APIs.", "/integrations"],
] as const;

export default function SettingsPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Configure the shared policies and integrations that drive every facility workflow."
      />
      <section className="module-grid">
        {modules.map(([Icon, title, copy, href]) => (
          <Link className="module-card" href={href} key={title}><Icon size={22} /><h3>{title}</h3><p>{copy}</p></Link>
        ))}
      </section>
      <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Two-step verification</h2><p className="panel-subtitle">Protect this staff account with an authenticator app and one-time recovery codes.</p></div><ShieldCheck className="positive-icon" /></div><MfaSettings /></section>
      <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Account password</h2><p className="panel-subtitle">Update your password and invalidate all existing sessions.</p></div><ShieldCheck className="positive-icon" /></div><ChangePasswordForm /></section>
    </div>
  );
}
