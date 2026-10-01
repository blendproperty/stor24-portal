import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { inspectReportExport } from "@/lib/dlp-policy";

/** Persist the decision before releasing bytes. An audit outage blocks release. */
export async function guardReportExport(input: { organisationId: string; actorId: string; reportKey: string; facilityId?: string; rows: ReadonlyArray<Record<string, unknown>> }) {
  const decision = inspectReportExport(input.reportKey, input.rows);
  const requestId = randomUUID();
  await db.auditEvent.create({ data: {
    organisationId: input.organisationId, actorId: input.actorId, facilityId: input.facilityId,
    entityType: "DlpExport", entityId: input.reportKey, requestId,
    action: decision.allowed ? "dlp.export.allowed" : "dlp.export.blocked",
    after: { ...decision, channel: "report-download" },
  } });
  return { ...decision, requestId };
}
