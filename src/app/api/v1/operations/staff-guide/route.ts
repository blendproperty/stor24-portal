import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requirePermissionScope } from "@/lib/scope";
import { apiError } from "@/lib/api";
import { guardDlpTransfer } from "@/lib/dlp-transfer-service";

export async function GET() {
  try {
    const scope = await requirePermissionScope("operations.view");
    const bytes = await readFile(join(process.cwd(), "private/staff-training/stor24-staff-handbook-2026-10-15.pdf"));
    const headers = await guardDlpTransfer({ organisationId: scope.organisationId, actorId: scope.userId, resourceId: "staff-handbook-2026-10-15", channel: "DOWNLOAD", classification: "confidential", byteLength: bytes.byteLength });
    await db.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "StaffHandbook", entityId: "2026-10-15", action: "staff.handbook_downloaded", after: { version: "2026-10-15", byteCount: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } } });
    return new Response(bytes, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": 'attachment; filename="STOR24-staff-handbook-2026-10-15.pdf"', "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && error.message === "DLP_TRANSFER_BLOCKED") return Response.json({ error: { message: "Data protection blocked this download. Ask your administrator to review the request." } }, { status: 422 });
    return apiError(error);
  }
}
