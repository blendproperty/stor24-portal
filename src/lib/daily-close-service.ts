import { db } from "@/lib/db";
import { Decimal } from "@prisma/client/runtime/client";
import { dailyCloseSchema } from "@/lib/validators";
import type { z } from "zod";

type CloseInput = z.infer<typeof dailyCloseSchema>;

/** Record an attested close snapshot. This does not lock financial postings. */
export async function recordDailyClose(organisationId: string, actorId: string, input: CloseInput) {
  input = dailyCloseSchema.parse(input);
  const businessDate = new Date(`${input.businessDate}T00:00:00.000Z`);
  try {
    return await db.$transaction(async tx => {
      const existing = await tx.dailyClose.findFirst({ where: { organisationId, facilityId: input.facilityId, businessDate } });
      if (existing?.status === "CLOSED") throw new Error("DAILY_CLOSE_ALREADY_CLOSED");
      const data = { ...input, businessDate, status: "CLOSED" as const, variance: new Decimal(input.countedCash).minus(input.expectedCash), closedById: actorId, closedAt: new Date() };
      let closed;
      if (existing) {
        const result = await tx.dailyClose.updateMany({ where: { id: existing.id, organisationId, status: { in: ["OPEN", "READY", "REOPENED"] } }, data });
        if (result.count !== 1) throw new Error("DAILY_CLOSE_ALREADY_CLOSED");
        closed = await tx.dailyClose.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        closed = await tx.dailyClose.create({ data: { organisationId, ...data } });
      }
      await tx.auditEvent.create({ data: { organisationId, facilityId: input.facilityId, actorId, action: "dailyClose.create", entityType: "dailyClose", entityId: closed.id, before: existing ? JSON.parse(JSON.stringify(existing)) : undefined, after: JSON.parse(JSON.stringify(closed)) } });
      return closed;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new Error("DAILY_CLOSE_ALREADY_CLOSED");
    throw error;
  }
}
