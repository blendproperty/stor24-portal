import { PageHeader } from "@/components/page-header";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { requireSession } from "@/lib/auth-guards";
import { availableReports } from "@/lib/reporting";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { facilityWhere, requireScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await requireSession();
  const permissions = session.permissions;
  const scope = await requireScope();
  const facilities = await db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } });
  const today = southAfricaDateKey(new Date());
  const from = `${today.slice(0, 8)}01`;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Governed operational and financial reporting for individual facilities and the portfolio."
      />
      <ReportsWorkspace reports={availableReports(permissions)} facilities={facilities} initialFrom={from} initialTo={today} canExport={hasPermission(permissions, "reports.export")} canSchedule={hasPermission(permissions, "reports.schedule")} />
    </div>
  );
}
