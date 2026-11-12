import { db } from "@/lib/db";
import { getTestCustomerCleanupPreview } from "@/lib/uat-reset-service";

export async function setReservationCustomerArchive(input: { organisationId: string; actorId: string; ids: string[]; fingerprint: string; archived: boolean }) {
  return db.$transaction(async tx => {
    const review = await getTestCustomerCleanupPreview(input.organisationId, input.ids, tx);
    if (review.fingerprint !== input.fingerprint) throw new Error("CONFLICT");
    const result = await tx.customer.updateMany({ where: { organisationId: input.organisationId, id: { in: input.ids } }, data: { reservationArchivedAt: input.archived ? new Date() : null } });
    if (result.count !== input.ids.length) throw new Error("CONFLICT");
    for (const id of input.ids) await tx.auditEvent.create({ data: { organisationId: input.organisationId, actorId: input.actorId, entityType: "Customer", entityId: id, action: input.archived ? "customer.reservation_archived" : "customer.reservation_restored" } });
    return { count: result.count };
  }, { isolationLevel: "Serializable" });
}
