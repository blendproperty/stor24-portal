import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { inspectReportExport } from "@/lib/dlp-policy";
import { rateLimit } from "@/lib/request-security";

/** Persist the decision before releasing bytes. An audit outage blocks release. */
export async function guardReportExport(input: { organisationId: string; actorId: string; reportKey: string; facilityId?: string; channel?: "report-preview" | "report-download"; rows: ReadonlyArray<Record<string, unknown>> }) {
  const decision = inspectReportExport(input.reportKey, input.rows);
  if (await rateLimit(`dlp:${input.organisationId}:DOWNLOAD:${input.actorId}`, 60, 3600000)) { decision.allowed = false; decision.reasons.push("TRANSFER_RATE_LIMIT"); }
  const requestId = randomUUID();
  await db.auditEvent.create({ data: {
    organisationId: input.organisationId, actorId: input.actorId, facilityId: input.facilityId,
    entityType: "DlpExport", entityId: input.reportKey, requestId,
    action: decision.allowed ? "dlp.export.allowed" : "dlp.export.blocked",
    after: { ...decision, channel: input.channel ?? "report-download" },
  } });
  return { ...decision, requestId };
}
