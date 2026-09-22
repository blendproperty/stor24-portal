import { FacialPhotoQueue } from "@/components/facial-photo-queue";
import { listFacialPhotos } from "@/lib/facial-photo-service";
import { facialPhotoPolicy } from "@/lib/facial-photo-security";
import { requirePermission } from "@/lib/auth-guards";
import { BiometricAccessWorkspace } from "@/components/biometric-access-workspace";
import { MelIntegrationStatus } from "@/components/mel-integration-status";
import { PageHeader } from "@/components/page-header";
import { listBiometricAccess } from "@/lib/biometric-access-service";
import { listAccessDecisions, listIdentityLinks } from "@/lib/mel-integration-status-service";
import { requirePermissionScope } from "@/lib/scope";

export const metadata = { title: "Biometric access" };
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const scope = await requirePermissionScope("access.view");
  const [enrollments, identityLinks, accessDecisions] = await Promise.all([
    listBiometricAccess(scope),
    listIdentityLinks(scope),
    listAccessDecisions(scope),
  ]);
  const photos = await listFacialPhotos(scope);
  let manageableFacilities: string[] | null = [];
  try { manageableFacilities = (await requirePermission("access.manage")).allowedFacilityIds; }
  catch (error) { if (!(error instanceof Error) || error.message !== "FORBIDDEN") throw error; }
  return <div className="page-stack face-page">
    <PageHeader eyebrow="Physical security" title="Facial access" description="Private photographs, staff review and a clear record of what still needs to be verified." />
    <FacialPhotoQueue policyConfigured={Boolean(facialPhotoPolicy(scope.organisationId))} manageableFacilities={manageableFacilities} photos={photos.map(photo => ({ id: photo.id, version: photo.version, status: photo.status, expiresAt: photo.expiresAt.toISOString(), facilityId: photo.reservation.facilityId, facilityName: photo.reservation.facility.name, unitNumber: photo.reservation.unit.number, customerName: [photo.reservation.customer.firstName ?? photo.reservation.customer.companyName ?? "Customer", photo.reservation.customer.lastName].filter(Boolean).join(" ") }))} />
    <BiometricAccessWorkspace
      enrollments={enrollments.map((item) => ({ id: item.id, customerName: `${item.customer.firstName ?? item.customer.companyName ?? "Customer"} ${item.customer.lastName ?? ""}`.trim(), facilityName: item.facility.name, unitNumber: item.occupancy.unit.number, status: item.status, consentAt: item.consentAt.toISOString(), provisionedAt: item.provisionedAt?.toISOString() ?? null }))}
    />
    <details className="face-provider-records"><summary>Provider records <span>Identity links and access decisions</span></summary><MelIntegrationStatus
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
    /></details>
  </div>;
}
