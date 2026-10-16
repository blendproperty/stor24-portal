import { db } from "@/lib/db";
import { trainingAccess } from "@/lib/move-in-training";
import { trainingDebtorCreate, trainingDebtorRecord, type TrainingDebtorSnapshot } from "@/lib/training-debtor-contract";

const action = "training.debtor_created";
const entityType = "TrainingDebtor";

/** Immutable training events are the only balance source. Never use Account/Payment/LedgerEntry. */
export async function trainingDebtors(userId: string): Promise<TrainingDebtorSnapshot> {
  const access = await trainingAccess(db, userId);
  const events = await db.auditEvent.findMany({ where: { organisationId: access.organisationId, entityType, action, facilityId: { in: access.facilities.map(f => f.id) } }, orderBy: { occurredAt: "desc" } });
  const rows: TrainingDebtorSnapshot["rows"] = [];
  for (const event of events) {
    const parsed = trainingDebtorRecord.safeParse(event.after);
    if (!parsed.success || parsed.data.customerId !== event.entityId || parsed.data.facilityId !== event.facilityId) continue;
    const record = parsed.data;
    const customer = await db.customer.findFirst({
      where: { id: record.customerId, organisationId: access.organisationId, leads: { some: { facilityId: record.facilityId } } },
      select: { firstName: true, lastName: true },
    });
    const facility = access.facilities.find(f => f.id === record.facilityId);
    if (!customer || !facility) continue;
    rows.push({ ...record, name: [customer.firstName, customer.lastName].filter(Boolean).join(" "), facility: facility.name, createdAt: event.occurredAt.toISOString(), outstandingCents: record.chargedCents - record.illustrativePaidCents });
  }
  return { canCreate: access.owner, facilities: access.facilities, rows };
}

/** Owner creates one shared, fixed, nonpostable example per store. Retrying returns the same customer. */
export async function createTrainingDebtor(userId: string, raw: unknown) {
  const input = trainingDebtorCreate.parse(raw);
  const before = await trainingAccess(db, userId);
  if (!before.owner) throw new Error("FORBIDDEN");
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${before.organisationId} FOR UPDATE`;
    const access = await trainingAccess(tx, userId);
    if (!access.owner || access.organisationId !== before.organisationId || !access.facilities.some(f => f.id === input.facilityId)) throw new Error("FORBIDDEN");
    const facility = await tx.facility.findFirst({ where: { id: input.facilityId, organisationId: access.organisationId, active: true } });
    if (!facility) throw new Error("FORBIDDEN");
    const existing = await tx.auditEvent.findFirst({ where: { organisationId: access.organisationId, facilityId: facility.id, entityType, action } });
    if (existing) return;
    const customer = await tx.customer.create({ data: {
      organisationId: access.organisationId, firstName: "TEST", lastName: "Faeez debtor training",
      notes: "TRAINING ONLY: TRAINING-DEBTOR-001. R1,000 illustrative charge less R400 illustrative payment = R600 training amount due. Open Training balances from Customers & tenants. Not a real debt, receipt, agreement, reservation or access authorisation. No customer contact details or communication consent.",
      communicationConsent: { email: false, sms: false, whatsapp: false, phone: false, source: "OWNER_TRAINING_ONLY" },
    } });
    // A closed training enquiry supplies the existing customer-page store scope, without reserving a unit.
    await tx.lead.create({ data: { customerId: customer.id, facilityId: facility.id, source: "Staff training only", stage: "LOST", notes: "Closed synthetic training enquiry; no commercial follow-up or customer contact." } });
    const record = trainingDebtorRecord.parse({ version: 1, trainingOnly: true, customerId: customer.id, facilityId: facility.id, reference: "TRAINING-DEBTOR-001", chargedCents: 100000, illustrativePaidCents: 40000 });
    await tx.auditEvent.create({ data: { organisationId: access.organisationId, facilityId: facility.id, actorId: userId, entityType: "Customer", entityId: customer.id, action: "customer.created", after: { trainingOnly: true } } });
    await tx.auditEvent.create({ data: { organisationId: access.organisationId, facilityId: facility.id, actorId: userId, entityType, entityId: customer.id, action, after: record } });
  });
  return trainingDebtors(userId);
}
