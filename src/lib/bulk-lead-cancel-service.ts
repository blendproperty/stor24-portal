import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";

export const bulkLeadCancelSchema = z.object({
  confirmed: z.literal(true),
  operation: z.enum(["cancel", "delete"]).optional(),
  leads: z.array(z.object({ id: z.string().min(1).max(100), updatedAt: z.iso.datetime() }).strict()).min(1).max(100),
}).strict().refine(input => new Set(input.leads.map(lead => lead.id)).size === input.leads.length);

export async function cancelTestLeads(scope: RequestScope, input: z.infer<typeof bulkLeadCancelSchema>) {
  return db.$transaction(async tx => {
    const ids = input.leads.map(lead => lead.id).sort();
    const where = { id: { in: ids }, facility: facilityWhere(scope) };
    if (await tx.lead.count({ where }) !== ids.length) throw new Error("NOT_FOUND");
    // Lock in one order so overlapping selections cannot overwrite each other.
    await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    const leads = await tx.lead.findMany({ where, include: { reservations: { select: { status: true } } } });
    if (leads.length !== ids.length) throw new Error("NOT_FOUND");
    const versions = new Map(input.leads.map(lead => [lead.id, lead.updatedAt]));
    for (const lead of leads) {
      if (lead.updatedAt.getTime() !== new Date(versions.get(lead.id)!).getTime()) throw new Error("CONFLICT");
      if (["RESERVED", "WON"].includes(lead.stage) || lead.reservations.some(r => ["ACTIVE", "CONVERTED"].includes(r.status))) throw new Error("LEAD_BOOKING_STAGE");
      if (input.operation === "delete") {
        if (lead.reservations.length) throw new Error("LEAD_BOOKING_STAGE");
        // The shared training balance uses this enquiry for customer store access.
        if (lead.source === "Staff training only") throw new Error("TRAINING_LEAD");
        if (lead.stage !== "LOST") throw new Error("CONFLICT");
      } else if (lead.stage === "LOST") throw new Error("CONFLICT");
    }
    for (const lead of leads) {
      const changed = input.operation === "delete"
        ? await tx.lead.deleteMany({ where: { id: lead.id, updatedAt: lead.updatedAt, stage: "LOST", reservations: { none: {} } } })
        : await tx.lead.updateMany({ where: { id: lead.id, updatedAt: lead.updatedAt }, data: { stage: "LOST", nextActionAt: null } });
      if (changed.count !== 1) throw new Error("CONFLICT");
      await tx.auditEvent.create({ data: {
        organisationId: scope.organisationId, facilityId: lead.facilityId, actorId: scope.userId,
        action: input.operation === "delete" ? "lead.test_deleted" : "lead.test_cancelled", entityType: "Lead", entityId: lead.id,
        before: { stage: lead.stage, nextActionAt: lead.nextActionAt?.toISOString() ?? null },
        after: input.operation === "delete" ? { deleted: true, reason: "TEST_ENQUIRY" } : { stage: "LOST", nextActionAt: null, reason: "TEST_ENQUIRY" },
      } });
    }
    return { count: leads.length };
  });
}
