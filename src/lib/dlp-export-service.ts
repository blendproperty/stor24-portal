import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { inspectReportExport, personalExportFields } from "@/lib/dlp-policy";
import { rateLimit } from "@/lib/request-security";

/** Persist the decision before releasing bytes. An audit outage blocks release. */
export async function guardReportExport(input: { organisationId: string; actorId: string; reportKey: string; facilityId?: string; channel?: "report-preview" | "report-download"; personalDataAllowed?: boolean; columnLabels?: string[]; payloadSource?: "database" | "browser-selected"; format?: string; period?: { from: string; to: string }; rows: ReadonlyArray<Record<string, unknown>> }) {
  const decision = inspectReportExport(input.reportKey, input.rows);
  const headerRows = input.columnLabels ? [{ csvHeader: input.columnLabels.join(" ") }] : [];
  if (headerRows.length) {
    const headerDecision = inspectReportExport(input.reportKey, headerRows);
    decision.allowed = decision.allowed && headerDecision.allowed;
    decision.reasons = [...new Set([...decision.reasons, ...headerDecision.reasons])].sort();
    if (headerDecision.classification === "restricted") decision.classification = "restricted";
  }
  const personalFields = input.channel === "report-preview" ? [] : [...new Set([...personalExportFields(input.rows), ...personalExportFields(headerRows)])];
  const auditedPersonalFields = input.payloadSource === "browser-selected"
    ? personalFields.map(key => key === "csvHeader" ? "Column labels" : `Column ${Object.keys(input.rows[0] ?? {}).indexOf(key) + 1}`) : personalFields;
  if (personalFields.length) decision.classification = "restricted";
  if (personalFields.length && !input.personalDataAllowed) {
    decision.allowed = false; decision.reasons.push("PERSONAL_EXPORT_PERMISSION_REQUIRED");
  }
  if (await rateLimit(`dlp:${input.organisationId}:DOWNLOAD:${input.actorId}`, 60, 3600000)) { decision.allowed = false; decision.reasons.push("TRANSFER_RATE_LIMIT"); }
  const requestId = randomUUID();
  await db.auditEvent.create({ data: {
    organisationId: input.organisationId, actorId: input.actorId, facilityId: input.facilityId,
    entityType: "DlpExport", entityId: input.reportKey, requestId,
    action: decision.allowed ? "dlp.export.allowed" : "dlp.export.blocked",
    after: { ...decision, channel: input.channel ?? "report-download", payloadSource: input.payloadSource ?? "database", format: input.format ?? null, period: input.period ?? null, personalFields: auditedPersonalFields, personalDataAllowed: input.personalDataAllowed === true },
  } });
  return { ...decision, requestId };
}
