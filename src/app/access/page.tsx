import { BiometricAccessWorkspace } from "@/components/biometric-access-workspace";
import { MelIntegrationStatus } from "@/components/mel-integration-status";
import { PageHeader } from "@/components/page-header";
import { listBiometricAccess } from "@/lib/biometric-access-service";
import { db } from "@/lib/db";
import { listAccessDecisions, listIdentityLinks } from "@/lib/mel-integration-status-service";
import { requirePermissionScope } from "@/lib/scope";

export const metadata = { title: "Biometric access" };
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const scope = await requirePermissionScope("access.view");
  const [occupancies, enrollments, identityLinks, accessDecisions] = await Promise.all([
    db.occupancy.findMany({ where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, tenancy: { facility: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } }) } } }, include: { unit: true, tenancy: { include: { facility: true, customer: true } } }, orderBy: { updatedAt: "desc" } }),
    listBiometricAccess(scope),
    listIdentityLinks(scope),
    listAccessDecisions(scope),
  ]);
  return <div className="page-stack">
    <PageHeader eyebrow="Physical security" title="Facial access" description="Consent-led HikCentral enrolment for active Stor24 tenants, with immediate revocation and a complete audit trail." />
    <BiometricAccessWorkspace
      candidates={occupancies.map((occupancy) => ({ occupancyId: occupancy.id, facilityId: occupancy.tenancy.facilityId, customerId: occupancy.tenancy.customerId, label: `${occupancy.tenancy.customer.firstName ?? occupancy.tenancy.customer.companyName ?? "Customer"} ${occupancy.tenancy.customer.lastName ?? ""} · ${occupancy.tenancy.facility.name} · Unit ${occupancy.unit.number}`.trim() }))}
      enrollments={enrollments.map((item) => ({ id: item.id, customerName: `${item.customer.firstName ?? item.customer.companyName ?? "Customer"} ${item.customer.lastName ?? ""}`.trim(), facilityName: item.facility.name, unitNumber: item.occupancy.unit.number, status: item.status, consentAt: item.consentAt.toISOString(), provisionedAt: item.provisionedAt?.toISOString() ?? null }))}
    />
    <MelIntegrationStatus
      identityLinks={identityLinks.map((link) => ({
        id: link.id,
        customerName: `${link.customer.firstName ?? link.customer.companyName ?? "Customer"} ${link.customer.lastName ?? ""}`.trim(),
        melIntegrationLinkId: link.melIntegrationLinkId,
        hikCentralPersonId: link.hikCentralPersonId,
        status: link.status,
        linkedAt: link.linkedAt?.toISOString() ?? null,
        resolvedByName: link.resolvedBy?.name ?? null,
      }))}
      accessDecisions={accessDecisions.map((decision) => ({
        id: decision.id,
        customerName: `${decision.occupancy.tenancy.customer.firstName ?? decision.occupancy.tenancy.customer.companyName ?? "Customer"} ${decision.occupancy.tenancy.customer.lastName ?? ""}`.trim(),
        facilityName: decision.facility.name,
        unitNumber: decision.occupancy.unit.number,
        action: decision.action,
        source: decision.source,
        state: decision.state,
        reason: decision.reason,
        attempts: decision.attempts,
        failureCode: decision.failureCode,
        createdAt: decision.createdAt.toISOString(),
        updatedAt: decision.updatedAt.toISOString(),
      }))}
    />
  </div>;
}
