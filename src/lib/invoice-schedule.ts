import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { southAfricaDateKey } from "@/lib/south-africa-time";

const schema = z.object({ date: z.iso.date() }).strict();
const domain = "NEXT_INVOICE_SCHEDULE";
export async function scheduledInvoiceDate(tx: Prisma.TransactionClient, organisationId: string, facilityId: string, now: Date) {
  const today = southAfricaDateKey(now);
  const profile = await tx.configurationProfile.findFirst({ where: { organisationId, facilityId, domain, name: "override", status: "READY" }, select: { config: true } });
  const parsed = schema.safeParse(profile?.config);
  if (profile && !parsed.success) throw new Error("BILLING_SCHEDULE_REVIEW");
  return parsed.success && parsed.data.date.slice(0, 7) === today.slice(0, 7) ? parsed.data.date : `${today.slice(0, 7)}-17`;
}
export async function readInvoiceSchedule(scope: RequestScope, facilityId: string) {
  const facility = await db.facility.findFirst({ where: { AND: [{ id: facilityId }, facilityWhere(scope)] }, select: { id: true } });
  if (!facility) throw new Error("FORBIDDEN");
  return { date: await scheduledInvoiceDate(db, scope.organisationId, facilityId, new Date()) };
}
export async function saveInvoiceSchedule(scope: RequestScope, facilityId: string, raw: unknown) {
  const input = schema.parse(raw), today = southAfricaDateKey(new Date());
  if (input.date.slice(0, 7) !== today.slice(0, 7) || input.date < today) throw new Error("BILLING_SCHEDULE_DATE_INVALID");
  return db.$transaction(async tx => {
    const facility = await tx.facility.findFirst({ where: { AND: [{ id: facilityId }, facilityWhere(scope)] }, select: { id: true } });
    if (!facility) throw new Error("FORBIDDEN");
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${facilityId} FOR UPDATE`;
    const previous = await tx.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId, domain, name: "override" } });
    await tx.configurationProfile.upsert({ where: { organisationId_facilityId_domain_name: { organisationId: scope.organisationId, facilityId, domain, name: "override" } }, create: { organisationId: scope.organisationId, facilityId, domain, name: "override", status: "READY", config: input }, update: { status: "READY", config: input } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "billing.schedule_changed", entityType: "Facility", entityId: facilityId, before: previous?.config ?? undefined, after: input } });
    return input;
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
