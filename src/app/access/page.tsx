import { FacialPhotoQueue } from "@/components/facial-photo-queue";
import { listFacialPhotos } from "@/lib/facial-photo-service";
import { photoControlSnapshot } from "@/lib/facial-photo-control";
import { PhotoCollectionControl } from "@/components/photo-collection-control";
import { BiometricAccessWorkspace } from "@/components/biometric-access-workspace";
import { MelIntegrationStatus } from "@/components/mel-integration-status";
import { PageHeader } from "@/components/page-header";
import { listBiometricAccess } from "@/lib/biometric-access-service";
import { listAccessDecisions, listIdentityLinks } from "@/lib/mel-integration-status-service";
import { facilityWhere, requirePermissionScope, type RequestScope } from "@/lib/scope";
import { leasingCustomerWhere } from "@/lib/leasing-customer-scope";
import { additionalPersonPolicy, listAdditionalPeopleForStaff } from "@/lib/additional-access-people";
import { AdditionalAccessQueue } from "@/components/additional-access-queue";
import { primaryTrialSnapshot } from "@/lib/unit58-primary-photo-trial";
import { db } from "@/lib/db";
import { HikCentralExistingPersonLink } from "@/components/hikcentral-existing-person-link";
import { HikCentralFaceCaptureWorkspace } from "@/components/hikcentral-face-capture-workspace";
import { HikCentralSiteClearance } from "@/components/hikcentral-site-clearance";

export const metadata = { title: "Biometric access" };
export const dynamic = "force-dynamic";

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const { reservation } = await searchParams;
  const scope = await requirePermissionScope("access.view");
  const [enrollments, identityLinks, accessDecisions] = await Promise.all([
    listBiometricAccess(scope),
    listIdentityLinks(scope),
    listAccessDecisions(scope),
  ]);
  const control = await photoControlSnapshot(scope.organisationId, scope.userId);
  const photos = await listFacialPhotos(scope, reservation);
  const additionalPeople = await listAdditionalPeopleForStaff(scope, reservation);
  const additionalPolicy = additionalPersonPolicy(scope.organisationId);
  const primaryTrial = await primaryTrialSnapshot(scope);
  let manageableFacilities: string[] | null = [];
  let captureScope: RequestScope | null = null;
  try { captureScope = await requirePermissionScope("access.manage"); manageableFacilities = captureScope.unrestrictedFacilities ? null : captureScope.facilityIds; }
  catch (error) { if (!(error instanceof Error) || error.message !== "FORBIDDEN") throw error; }
  let canLinkExistingPerson = false;
  try { canLinkExistingPerson = manageableFacilities === null && (await requirePermissionScope("integrations.manage")).unrestrictedFacilities; }
  catch (error) { if (!(error instanceof Error) || error.message !== "FORBIDDEN") throw error; }
  const [linkCustomers, linkFacilities] = canLinkExistingPerson ? await Promise.all([
    db.customer.findMany({ where: { organisationId: scope.organisationId }, select: { id: true, firstName: true, lastName: true, companyName: true }, orderBy: { updatedAt: "desc" } }),
    db.facility.findMany({ where: { organisationId: scope.organisationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]) : [[], []];
  const [capturePeople, captureFacilities] = captureScope ? await Promise.all([
    db.customer.findMany({ where: { ...leasingCustomerWhere(captureScope, captureScope.facilityIds), type: "INDIVIDUAL", firstName: { not: null }, lastName: { not: null } }, include: { integrationIdentityLink: true, hikCentralFaceCapture: true, hikCentralAccessGrants: { select: { facilityId: true, status: true } } }, orderBy: { updatedAt: "desc" } }),
    db.facility.findMany({ where: facilityWhere(captureScope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]) : [[], []];
  return <div className="page-stack face-page">
    <PageHeader eyebrow="Physical security" title="Facial access" description="Staff prepare a private tablet photo visit. After the customer consents, an integration manager reviews and sends the image to HikCentral." />
    {reservation && <a className="button button-secondary" href={`/operations/move-in?reservation=${encodeURIComponent(reservation)}`}>Back to move-in checks</a>}
    <ol className="face-journey" aria-label="Customer photo steps">
      <li><span>1</span><div><strong>Choose the customer</strong><p>Staff check the original ID against STOR24. A manager links anyone already in HikCentral; new people are created after photo review.</p></div></li>
      <li><span>2</span><div><strong>Take the photo on the tablet</strong><p>Staff prepare a QR code. The customer scans it, agrees and takes their own photo.</p></div></li>
      <li><span>3</span><div><strong>Review and send</strong><p>Staff review the saved image before sending it to HikCentral.</p></div></li>
    </ol>
    {captureScope ? <HikCentralFaceCaptureWorkspace people={capturePeople.map(customer => ({ customerId: customer.id, customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" "), personId: customer.integrationIdentityLink?.hikCentralPersonId ?? null, linkStatus: customer.integrationIdentityLink?.status ?? null, accessGrants: customer.hikCentralAccessGrants, photo: customer.hikCentralFaceCapture ? { id: customer.hikCentralFaceCapture.id, version: customer.hikCentralFaceCapture.version, status: customer.hikCentralFaceCapture.status, consentAt: customer.hikCentralFaceCapture.consentAt.toISOString(), providerAcceptedAt: customer.hikCentralFaceCapture.providerAcceptedAt?.toISOString() ?? null } : null }))} facilities={captureFacilities} canSend={canLinkExistingPerson} /> : null}
    {captureScope ? <HikCentralSiteClearance facilities={captureFacilities} /> : null}
    {canLinkExistingPerson ? <details className="face-provider-records"><summary>Already in HikCentral? <span>Manager: link an existing person without creating a duplicate</span></summary><HikCentralExistingPersonLink customers={linkCustomers.map(customer => ({ id: customer.id, name: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer" }))} facilities={linkFacilities} /></details> : null}
    <details className="face-provider-records face-settings" open={!control.enabled}><summary>Photo collection settings <span>{control.enabled ? "On — owner controls and interim rules" : "Off — photo uploads are paused"}</span></summary><PhotoCollectionControl initial={control} /></details>
    <details className="face-provider-records face-legacy-workflows" open={Boolean(reservation)}><summary>Booking and additional-person workflows <span>Separate from the HikCentral customer photo table above</span></summary><div className="page-stack">
    {primaryTrial && <section className="face-primary-trial" aria-label="Unit 58 primary customer photo trial">
      <span className="face-eyebrow">UNIT {primaryTrial.unitNumber} · PHOTO ONLY</span>
      <h2>Start with the account holder</h2>
      <p>The customer service operator opens Move-in on the staff tablet for <strong>{primaryTrial.customerName}</strong>, checks the original ID, then supervises the customer&apos;s own photo and consent. Staff review the saved photo there. Additional-person capture remains unavailable during this first test.</p>
      <p className="face-primary-trial-status">Primary photo: {primaryTrial.photoStatus.replaceAll("_", " ").toLowerCase()}. No door access is granted.</p>
      <div className="face-primary-trial-actions"><a className="button button-secondary" href="/operations/move-in#legacy-handovers">Open staff tablet capture and review</a></div>
    </section>}
    <FacialPhotoQueue policyConfigured={control.enabled} manageableFacilities={manageableFacilities} photos={photos.map(photo => ({ id: photo.id, version: photo.version, status: photo.status, expiresAt: photo.expiresAt?.toISOString() ?? null, facilityId: photo.reservation.facilityId, facilityName: photo.reservation.facility.name, unitNumber: photo.reservation.unit.number, customerName: [photo.reservation.customer.firstName ?? photo.reservation.customer.companyName ?? "Customer", photo.reservation.customer.lastName].filter(Boolean).join(" ") }))} />
    <AdditionalAccessQueue people={additionalPeople.map(person => ({ id: person.id, reservationId: person.reservationId, name: person.name, status: person.status, photoVersion: person.photoVersion, expiresAt: person.expiresAt?.toISOString() ?? null, facilityId: person.reservation.facilityId, facilityName: person.reservation.facility.name, unitNumber: person.reservation.unit.number }))} policy={additionalPolicy ? { hash: additionalPolicy.hash, notice: additionalPolicy.notice, consentLabel: additionalPolicy.consentLabel, retentionHours: additionalPolicy.retentionHours, trialReservationId: additionalPolicy.trialReservationId } : null} manageableFacilities={manageableFacilities} />
    <BiometricAccessWorkspace
      enrollments={enrollments.map((item) => ({ id: item.id, customerName: `${item.customer.firstName ?? item.customer.companyName ?? "Customer"} ${item.customer.lastName ?? ""}`.trim(), facilityName: item.facility.name, unitNumber: item.occupancy.unit.number, status: item.status, consentAt: item.consentAt.toISOString(), provisionedAt: item.provisionedAt?.toISOString() ?? null }))}
    />
    </div></details>
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
