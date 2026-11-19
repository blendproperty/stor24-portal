import { db } from "@/lib/db";
import { requireLeasingCustomer } from "@/lib/leasing-customer-scope";
import { lookupHikCentralPerson } from "@/lib/integrations/hikcentral-configuration";
import { loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import type { RequestScope } from "@/lib/scope";

type ExistingPerson = { personId: string; personCode: string; organisationIndexCode: string; givenName: string; familyName: string };

export function assertExistingPersonLink(input: { customerLastName: string | null; personFamilyName: string; personId: string; expectedPersonId?: string; linkedToAnotherCustomer: boolean; currentPersonId?: string | null; currentStatus?: string }) {
  if (input.customerLastName && input.personFamilyName && input.customerLastName.trim().toLowerCase() !== input.personFamilyName.trim().toLowerCase()) throw new Error("HIKCENTRAL_PERSON_NAME_MISMATCH");
  if (input.expectedPersonId && input.personId !== input.expectedPersonId) throw new Error("HIKCENTRAL_PERSON_CHANGED");
  if (input.linkedToAnotherCustomer) throw new Error("HIKCENTRAL_PERSON_ALREADY_LINKED");
  if (input.currentPersonId && input.currentPersonId !== input.personId) throw new Error("HIKCENTRAL_CUSTOMER_ALREADY_LINKED");
  if (["DUPLICATE_SUSPECTED", "SUPERSEDED"].includes(input.currentStatus ?? "")) throw new Error("HIKCENTRAL_LINK_REVIEW_REQUIRED");
}

async function verifiedPerson(scope: RequestScope, facilityId: string, customerId: string, personCode: string) {
  const customer = await requireLeasingCustomer(scope, customerId);
  const response = await lookupHikCentralPerson(scope, facilityId, personCode);
  if (!response.ok) throw new Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
  const person = response.data as ExistingPerson;
  assertExistingPersonLink({ customerLastName: customer.lastName, personFamilyName: person.familyName, personId: person.personId, linkedToAnotherCustomer: false });
  return { customer, person };
}

export async function previewExistingHikCentralPerson(scope: RequestScope, facilityId: string, customerId: string, personCode: string) {
  const { customer, person } = await verifiedPerson(scope, facilityId, customerId, personCode);
  return { customerId: customer.id, customerName: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" "), ...person };
}

export async function linkExistingHikCentralPerson(scope: RequestScope, input: { facilityId: string; customerId: string; personCode: string; expectedPersonId: string; identityChecked: boolean }) {
  if (!input.identityChecked) throw new Error("PHOTO_IDENTITY_REQUIRED");
  const { customer, person } = await verifiedPerson(scope, input.facilityId, input.customerId, input.personCode);
  assertExistingPersonLink({ customerLastName: customer.lastName, personFamilyName: person.familyName, personId: person.personId, expectedPersonId: input.expectedPersonId, linkedToAnotherCustomer: false });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${scope.organisationId} FOR UPDATE`;
    await requireLeasingCustomer(scope, customer.id, tx);
    const duplicate = await tx.integrationIdentityLink.findFirst({ where: { organisationId: scope.organisationId, hikCentralPersonId: person.personId, customerId: { not: customer.id } } });
    const current = await tx.integrationIdentityLink.findUnique({ where: { customerId: customer.id } });
    assertExistingPersonLink({ customerLastName: customer.lastName, personFamilyName: person.familyName, personId: person.personId, expectedPersonId: input.expectedPersonId, linkedToAnotherCustomer: Boolean(duplicate), currentPersonId: current?.hikCentralPersonId, currentStatus: current?.status });
    const now = new Date();
    const link = await tx.integrationIdentityLink.upsert({ where: { customerId: customer.id }, create: { organisationId: scope.organisationId, customerId: customer.id, hikCentralPersonId: person.personId, status: "ACTIVE", linkedAt: now, resolvedById: scope.userId, resolutionNotes: "Existing HikCentral person matched to original ID by staff" }, update: { hikCentralPersonId: person.personId, status: "ACTIVE", linkedAt: current?.linkedAt ?? now, resolvedById: scope.userId, resolutionNotes: "Existing HikCentral person matched to original ID by staff" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "integration.hikcentral.existing_person_linked", entityType: "IntegrationIdentityLink", entityId: link.id, after: { customerId: customer.id, hikCentralPersonId: person.personId, identityCheckedInPerson: true } } });
    return { id: link.id, customerId: customer.id, hikCentralPersonId: person.personId, status: link.status };
  });
}

/** Reconcile a provider person deleted outside STOR24 before issuing a fresh photo visit. */
export async function reconcileDeletedHikCentralPerson(scope: RequestScope, input: { facilityId: string; customerId: string; expectedPersonId: string }) {
  const customer = await requireLeasingCustomer(scope, input.customerId);
  const link = await db.integrationIdentityLink.findUnique({ where: { customerId: customer.id } });
  if (!link || link.organisationId !== scope.organisationId || link.status !== "ACTIVE" || link.hikCentralPersonId !== input.expectedPersonId || !customer.lastName?.trim()) throw Error("HIKCENTRAL_LINK_REVIEW_REQUIRED");
  const photo = await db.hikCentralFaceCapture.findUnique({ where: { customerId: customer.id } });
  if (!photo || photo.facilityId !== input.facilityId || photo.personId !== input.expectedPersonId || photo.status !== "PROVIDER_ACCEPTED" || photo.encryptedImage) throw Error("HIKCENTRAL_LINK_REVIEW_REQUIRED");
  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
  if ((await provider.personById(input.expectedPersonId)).ok) throw Error("HIKCENTRAL_PERSON_STILL_EXISTS");
  const matches = await provider.peopleByName(customer.lastName.trim());
  if (!matches.ok) throw Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
  const firstName = customer.firstName?.trim().split(/\s+/)[0].toLowerCase();
  if (matches.data.people.some(item => item.personId === input.expectedPersonId || item.familyName.trim().toLowerCase() === customer.lastName!.trim().toLowerCase() && item.givenName.trim().split(/\s+/)[0].toLowerCase() === firstName)) throw Error("HIKCENTRAL_PERSON_STILL_EXISTS");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE`;
    const current = await tx.integrationIdentityLink.findUnique({ where: { customerId: customer.id } });
    const currentPhoto = await tx.hikCentralFaceCapture.findUnique({ where: { customerId: customer.id } });
    if (current?.id !== link.id || current.hikCentralPersonId !== input.expectedPersonId || current.status !== "ACTIVE" || currentPhoto?.id !== photo.id || currentPhoto.personId !== input.expectedPersonId || currentPhoto.status !== "PROVIDER_ACCEPTED") throw Error("HIKCENTRAL_LINK_REVIEW_REQUIRED");
    if (await tx.hikCentralAccessGrant.count({ where: { customerId: customer.id, personId: input.expectedPersonId, status: { not: "REVOKED" } } })) throw Error("HIKCENTRAL_ACCESS_REVIEW_REQUIRED");
    await tx.hikCentralAccessGrant.deleteMany({ where: { customerId: customer.id, personId: input.expectedPersonId, status: "REVOKED" } });
    await tx.hikCentralFaceHandoff.deleteMany({ where: { customerId: customer.id, usedAt: null } });
    await tx.integrationIdentityLink.update({ where: { id: link.id }, data: { hikCentralPersonId: null, status: "PENDING", resolutionNotes: "Previously linked HikCentral person absent in provider reconciliation" } });
    await tx.hikCentralFaceCapture.update({ where: { id: photo.id }, data: { personId: null, status: "PROVIDER_REMOVED" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "integration.hikcentral.deleted_person_reconciled", entityType: "IntegrationIdentityLink", entityId: link.id, before: { customerId: customer.id, personId: input.expectedPersonId, photoVersion: photo.version }, after: { customerId: customer.id, personId: null, photoVersion: photo.version, providerAbsenceChecked: true } } });
    return { customerId: customer.id, previousPersonId: input.expectedPersonId, status: "PROVIDER_REMOVED" };
  });
}
