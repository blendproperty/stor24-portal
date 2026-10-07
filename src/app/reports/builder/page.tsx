import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { VisualReportBuilder } from "@/components/visual-report-builder";
import { requireSession } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { requireScope,facilityWhere } from "@/lib/scope";
import { db } from "@/lib/db";
import { southAfricaDateKey } from "@/lib/south-africa-time";
export const metadata={title:"Report library & custom reports"};
export default async function ReportBuilderPage() {
  const actor=await requireSession(),scope=await requireScope(),to=southAfricaDateKey(new Date());
  const facilities=await db.facility.findMany({where:facilityWhere(scope),select:{id:true,name:true},orderBy:{name:"asc"}});
  return <div className="page-stack report-library-workspace"><PageHeader eyebrow="Analytics" title="Report library & custom reports" description="Build reports by choosing fields, filters and totals. Start from a template and save the reports you use."/><Link href="/reports" className="button button-secondary">Standard reports</Link><VisualReportBuilder facilities={facilities} from={`${to.slice(0,8)}01`} to={to} canExport={currentRoleAccess(actor.user.roleAssignments,"reports.export").allowed} canSchedule={currentRoleAccess(actor.user.roleAssignments,"reports.schedule").allowed} canShare={currentRoleAccess(actor.user.roleAssignments).owner}/></div>;
}
