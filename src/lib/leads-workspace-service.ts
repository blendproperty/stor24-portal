import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { leadAttributionSchema } from "@/lib/lead-attribution";
import { z } from "zod";
import { marketProfileSchema } from './lead-market-profile';

export const leadUpdateSchema = z.object({
  marketProfile: marketProfileSchema.optional(),
  updatedAt: z.iso.datetime(),
  stage: z.enum(["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "VIEWING_BOOKED", "RESERVED", "WON", "LOST"]),
  nextActionAt: z.iso.datetime().nullable(),
  notes: z.string().trim().max(2000),
  assignedToId: z.string().min(1).max(100).nullable(),
}).strict();
export type LeadUpdate = z.infer<typeof leadUpdateSchema>;

export async function leadsWorkspace(scope: RequestScope) {
  const facilities = await db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } });
  const where = { facilityId: { in: facilities.map(f => f.id) } };
  const [leads, count, staff] = await Promise.all([
    db.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: 2000,
      include: { customer: { select: { id: true, firstName: true, lastName: true, companyName: true, email: true, phone: true } },
        facility: { select: { id: true, name: true } }, desiredUnitType: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        reservations: { select: { id: true, status: true, journey: true, quotedRate: true, convertedTenancyId: true, publicLease: { select: { id: true, status: true, signedAt: true, signedPdfSha256: true } }, convertedTenancy: { select: { status: true, accountId: true, documents: { where: { type: "LEASE_AGREEMENT" }, select: { id: true, status: true, signedAt: true } } } }, unit: { select: { number: true } } } } } }),
    db.lead.count({ where }),
    db.user.findMany({ where: { organisationId: scope.organisationId, active: true,
      roleAssignments: { some: { OR: [{ facilityId: null }, { facilityId: { in: facilities.map(f => f.id) } }] } } },
      select: { id: true, name: true, roleAssignments: { select: { facilityId: true } } }, orderBy: { name: "asc" } }),
  ]);
  const evidence = leads.length ? await db.auditEvent.findMany({ where: { organisationId: scope.organisationId,
    entityType: "Lead", entityId: { in: leads.map(l => l.id) }, action: { in: ["public_lead.created", "lead.attribution.captured", "lead.market_profile.captured"] } },
    select: { entityId: true, after: true }, orderBy: { occurredAt: "asc" } }) : [];
  const attribution = new Map(evidence.flatMap(event => {
    const after = event.after as { attribution?: unknown } | null;
    const parsed = leadAttributionSchema.safeParse(after?.attribution);
    return parsed.success ? [[event.entityId, parsed.data] as const] : [];
  }));
  const marketProfiles=new Map(evidence.flatMap(event=>{const parsed=marketProfileSchema.safeParse((event.after as {marketProfile?:unknown}|null)?.marketProfile);return parsed.success?[[event.entityId,parsed.data] as const]:[];}));
  return { facilities, staff: staff.map(person => ({ id: person.id, name: person.name, facilityIds: person.roleAssignments.map(a => a.facilityId) })), count,
    leads: leads.map(lead => ({ ...lead, attribution: attribution.get(lead.id) ?? null,marketProfile:marketProfiles.get(lead.id)??null,
      stage: lead.reservations.some(r => r.status === "CONVERTED" && r.convertedTenancyId && ["ACTIVE", "NOTICE_GIVEN"].includes(r.convertedTenancy?.status ?? "")) ? "WON" : lead.stage,
      reservations: lead.reservations.map(r => ({ ...r, quotedRate: Number(r.quotedRate) })) })) };
}

export async function updateLead(scope: RequestScope, id: string, input: LeadUpdate) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${id} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { id, facility: facilityWhere(scope) }, include: { reservations: { select: { status: true, journey: true, convertedTenancyId: true, convertedTenancy: { select: { status: true } } } } } });
    if (!lead) throw new Error("NOT_FOUND");
    const converted = lead.reservations.some(r => r.status === "CONVERTED" && r.convertedTenancyId && ["ACTIVE", "NOTICE_GIVEN"].includes(r.convertedTenancy?.status ?? ""));
    if (input.stage === "WON" && !converted) throw new Error("LEAD_BOOKING_STAGE");
    if (input.stage === "RESERVED" && !lead.reservations.some(r => r.status === "ACTIVE" && r.journey === "RENTAL")) throw new Error("LEAD_BOOKING_STAGE");
    if (lead.reservations.some(r => ["ACTIVE", "CONVERTED"].includes(r.status)) && input.stage !== (converted ? "WON" : lead.stage)) throw new Error("LEAD_BOOKING_STAGE");
    if (input.assignedToId && !await tx.user.findFirst({ where: { id: input.assignedToId, organisationId: scope.organisationId, active: true,
      roleAssignments: { some: { OR: [{ facilityId: null }, { facilityId: lead.facilityId }] } } } })) throw new Error("FORBIDDEN");
    const changed = await tx.lead.updateMany({ where: { id, updatedAt: new Date(input.updatedAt) }, data: {
      stage: input.stage, nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
      notes: input.notes || null, assignedToId: input.assignedToId,
    } });
    if (changed.count !== 1) throw new Error("CONFLICT");
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: lead.facilityId, actorId: scope.userId,
      action: "lead.updated", entityType: "Lead", entityId: id,
      before: { stage: lead.stage, nextActionAt: lead.nextActionAt?.toISOString() ?? null, assignedToId: lead.assignedToId, notes: lead.notes },
      after: { stage: input.stage, nextActionAt: input.nextActionAt, assignedToId: input.assignedToId, notes: input.notes || null } } });
    if(input.marketProfile)await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:lead.facilityId,actorId:scope.userId,action:'lead.market_profile.captured',entityType:'Lead',entityId:id,after:{marketProfile:input.marketProfile}}});
    return { id };
  });
}
