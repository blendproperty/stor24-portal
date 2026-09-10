import { Boxes, ChartNoAxesCombined, Headphones, ShieldCheck } from "lucide-react";
import Image from "next/image";
import "@/styles/portal-entry.css";

export function PortalAuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="portal-entry portal-entry-refreshed">
      <section className="portal-brand-panel">
        <div className="portal-brand-glow" />
        <div className="portal-brand-lockup">
          <div className="portal-logo-plaque"><Image className="portal-official-logo" src="/brand/stor24-logo-official-email-20260909.svg" alt="STOR24" width={611} height={160} priority unoptimized /></div>
          <span>Team workspace</span>
        </div>
        <div className="portal-brand-copy">
          <p>Space for life in motion.</p>
          <h1>A little space.<br />A lot of possibility<span className="portal-orange-dot">.</span></h1>
          <p className="portal-brand-description">Behind every smooth move is a great team. Your people, spaces and daily operations — together in one place.</p>
        </div>
        <div className="portal-feature-row">
          <span><Boxes size={18} /> Live inventory</span>
          <span><ChartNoAxesCombined size={18} /> Portfolio insight</span>
          <span><Headphones size={18} /> Team workflows</span>
        </div>
        <div className="portal-security-note"><ShieldCheck size={18} /><span><strong>Protected workspace</strong>Encrypted session access with role-based permissions.</span></div>
      </section>
      <section className="portal-form-panel">
        <div className="portal-form-wrap">
          <div className="portal-mobile-brand"><Image className="portal-official-logo portal-official-logo-dark" src="/brand/stor24-logo-official-email-20260909.svg" alt="STOR24" width={611} height={160} priority unoptimized /></div>
          <p className="portal-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="portal-intro">{description}</p>
          {children}
          <p className="portal-support"><ShieldCheck size={15} aria-hidden="true" /> Authorised team access only.</p>
          <p className="portal-help">Need a hand? Contact your STOR24 administrator.</p>
        </div>
      </section>
    </main>
  );
}
