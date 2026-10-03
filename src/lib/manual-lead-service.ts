import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requireFacility, type RequestScope } from "@/lib/scope";
import { requireLeasingCustomer } from "@/lib/leasing-service";
import type { CreateLeadInput } from "@/lib/validators";
export async function createManualLead(scope: RequestScope, input: CreateLeadInput) {
  await requireFacility(scope, input.facilityId);
  if (input.desiredUnitTypeId && !await db.unitType.findFirst({where: {id: input.desiredUnitTypeId, facilityId: input.facilityId}})) throw new Error("FORBIDDEN");
  return db.$transaction(async tx => {
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if(input.submissionId) {
      const key = `${scope.organisationId}:${scope.userId}:${input.submissionId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const saved = await tx.auditEvent.findFirst({where: {organisationId: scope.organisationId, actorId: scope.userId, action: "lead.capture.saved", entityId: input.submissionId}});
      if(saved) {
        const evidence = saved.after as {leadId: string; inputHash: string};
        if(evidence.inputHash !== inputHash) throw new Error("CONFLICT");
        const lead = await tx.lead.findFirst({where: {id: evidence.leadId, facilityId: input.facilityId}});
        if(!lead) throw new Error("CONFLICT");
        return lead;
      }
    }
    const existing = "customerId" in input;
    const customer = existing ? await requireLeasingCustomer(scope, input.customerId, tx) : await tx.customer.create({data: {organisationId: scope.organisationId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone}});
    const notes = [input.source === "Other" ? `Other source: ${input.sourceDetail}` : null, input.notes].filter(Boolean).join("\n");
    const lead = await tx.lead.create({data: {facilityId: input.facilityId, customerId: customer.id, desiredUnitTypeId: input.desiredUnitTypeId, source: input.source, notes: notes || null, expectedMoveIn: input.expectedMoveIn, assignedToId: scope.userId}});
    if (!existing) await tx.auditEvent.create({data: {organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "customer.created", entityType: "Customer", entityId: customer.id}});
    await tx.auditEvent.create({data: {organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "lead.created", entityType: "Lead", entityId: lead.id, after: {stage: lead.stage, source: lead.source, sourceDetail: input.source === "Other" ? input.sourceDetail : null, customerId: customer.id, customerCreated: !existing, assignedToId: scope.userId}}});
    if(input.submissionId) await tx.auditEvent.create({data: {organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "lead.capture.saved", entityType: "LeadCapture", entityId: input.submissionId, after: {leadId: lead.id, inputHash}}});
    return lead;
  });
}
