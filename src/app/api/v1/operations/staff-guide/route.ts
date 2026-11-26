import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requirePermissionScope } from "@/lib/scope";
import { apiError } from "@/lib/api";
import { guardDlpTransfer } from "@/lib/dlp-transfer-service";

const documents = {
  handbook: { file: "stor24-staff-handbook-2026-10-15.pdf", download: "STOR24-staff-handbook-2026-10-15.pdf", id: "2026-10-15", resource: "staff-handbook-2026-10-15", version: "2026-10-15" },
  "facilities-guide": { file: "STOR24-Facilities-Manager-Guide-2026-11-26.pdf", download: "STOR24-Facilities-Manager-Guide-2026-11-26.pdf", id: "facilities-guide-2026-11-26", resource: "facilities-guide-2026-11-26", version: "2026-11-26" },
  "facilities-training": { file: "STOR24-Facilities-Manager-Training-2026-11-26.pdf", download: "STOR24-Facilities-Manager-Training-2026-11-26.pdf", id: "facilities-training-2026-11-26", resource: "facilities-training-2026-11-26", version: "2026-11-26" },
} as const;

export async function GET(request?: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const key = request ? new URL(request.url).searchParams.get("document") ?? "handbook" : "handbook";
    if (!Object.hasOwn(documents, key)) throw new Error("NOT_FOUND");
    const document = documents[key as keyof typeof documents];
    const bytes = await readFile(join(process.cwd(), "private/staff-training", document.file));
    const headers = await guardDlpTransfer({ organisationId: scope.organisationId, actorId: scope.userId, resourceId: document.resource, channel: "DOWNLOAD", classification: "confidential", byteLength: bytes.byteLength });
    await db.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "StaffHandbook", entityId: document.id, action: "staff.handbook_downloaded", after: { version: document.version, byteCount: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } } });
    return new Response(bytes, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="${document.download}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && error.message === "DLP_TRANSFER_BLOCKED") return Response.json({ error: { message: "Data protection blocked this download. Ask your administrator to review the request." } }, { status: 422 });
    return apiError(error);
  }
}
