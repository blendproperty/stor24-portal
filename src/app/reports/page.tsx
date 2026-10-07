import { PageHeader } from "@/components/page-header";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { requireSession } from "@/lib/auth-guards";
import { availableReports } from "@/lib/reporting";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { facilityWhere, requireScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import Link from 'next/link';
import { currentRoleAccess } from '@/lib/current-role-access';

export const metadata = { title: "Reports" };

export default async function ReportsPage({searchParams}:{searchParams:Promise<{reportKey?:string}>}) {
  const requestedReport=(await searchParams).reportKey;
  const session = await requireSession();
  const permissions = session.permissions;
  const scope = await requireScope();
  const facilities = await db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } });
  const today = southAfricaDateKey(new Date());
  const from = `${today.slice(0, 8)}01`;
  return (
    <div className="page-stack report-library-workspace">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Governed operational and financial reporting for individual facilities and the portfolio."
      />
      <div className="report-shortcuts">
      <section className="panel report-shortcut"><h2>Report library & custom reports</h2><p>Choose a template or build your own report with fields, filters and totals. Save reports, create bundles and review scheduled snapshots.</p><Link href="/reports/builder" className="button button-primary">Open report builder</Link></section>
      {hasPermission(permissions,'leads.view')&&<section className="panel report-shortcut"><h2>Marketing and customer profile</h2><p>Compare enquiry sources, personal or business storage and voluntarily recorded gender with the selected reporting period and store.</p><Link href="/marketing" className="button button-secondary">Open marketing reports</Link></section>}
      {currentRoleAccess(session.user.roleAssignments).owner && <section className="panel report-shortcut"><h2>Tenant duration & rent changes</h2><p>Days in each unit, days since a recorded price change and scheduled group increases.</p><Link className="button button-secondary" href="/billing/rent-reviews">Open tenant duration report</Link></section>}
      </div>
      <ReportsWorkspace reports={availableReports(permissions)} facilities={facilities} initialFrom={from} initialTo={today} initialReportKey={requestedReport} canExport={hasPermission(permissions, "reports.export")} />
    </div>
  );
}
