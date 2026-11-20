import { db } from "@/lib/db";
import { requireLeasingCustomer } from "@/lib/leasing-customer-scope";
import type { RequestScope } from "@/lib/scope";

export async function addCompanyFacePerson(scope: RequestScope, input: { companyId: string; firstName: string; lastName: string; authorised: boolean }) {
  const firstName = input.firstName.trim(), lastName = input.lastName.trim();
  if (!scope.userId || !input.authorised || !firstName || !lastName || firstName.length > 100 || lastName.length > 100) throw Error("COMPANY_PERSON_INVALID");
  const company = await requireLeasingCustomer(scope, input.companyId);
  if (company.type !== "BUSINESS" || !company.companyName?.trim()) throw Error("COMPANY_PERSON_INVALID");
  const person = await db.$transaction(async tx => {
    const created = await tx.customer.create({ data: { organisationId: scope.organisationId, type: "INDIVIDUAL", firstName, lastName, accessCompanyId: company.id } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "company_face_person.authorised", entityType: "Customer", entityId: created.id, after: { companyId: company.id, firstName, lastName } } });
    return created;
  });
  return { customerId: person.id };
}
