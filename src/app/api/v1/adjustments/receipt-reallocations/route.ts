import { z } from "zod";
import { sameOrigin } from "@/lib/request-security";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { receiptCorrectionScope, receiptCorrectionCapabilities } from "@/lib/receipt-reallocation-access";
import { receiptReallocationInput } from "@/lib/receipt-reallocation-policy";
import { requestReceiptReallocation, decideReceiptReallocation } from "@/lib/receipt-reallocation-service";
import { receiptCorrectionWorkspace, receiptCorrectionPreview, receiptCorrectionDocument } from "@/lib/receipt-reallocation-workspace";
import {confirmedFinanceRollback} from '@/lib/finance/retry-rolled-back-transaction';

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: receiptReallocationInput }).strict(),
  z.object({ action: z.literal("request"), input: receiptReallocationInput, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("decide"), id: z.cuid(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), decision: z.enum(["approve", "reject", "cancel"]), reference: z.string().trim().min(5).max(200), confirmed: z.literal(true) }).strict(),
]);

async function boundedBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("REALLOCATION_BODY");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 16384)) throw Error("REALLOCATION_BODY");
  const reader = request.body?.getReader();
  if (!reader) throw Error("REALLOCATION_BODY");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw Error("REALLOCATION_BODY"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof TypeError) throw Error("REALLOCATION_BODY");
    throw error;
  } finally { reader.releaseLock(); }
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const json = (status: number, message: string) => Response.json({ error: { message } }, { status, headers });
  if (code === "UNAUTHENTICATED") return json(401, "Sign in is required.");
  if (code === "FORBIDDEN" || code === "FACILITY_FORBIDDEN") return json(403, "You do not have permission for these accounts and this action.");
  if (code === "REALLOCATION_NOT_FOUND") return json(404, "The scoped receipt correction was not found.");
  if (error instanceof z.ZodError || error instanceof SyntaxError || code === "REALLOCATION_BODY") return json(400, "Check the request details, amount and supporting reference.");
  if (code === "PERSONAL_EXPORT_FORBIDDEN") return json(403, "You do not have permission to export this document.");
  if (code === "DLP_TRANSFER_BLOCKED") return json(422, "Data protection blocked this document.");
  if (code.startsWith("REALLOCATION_") || confirmedFinanceRollback(error) || error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return json(409, "This receipt needs a fresh review. Reload the accounts and correction history before trying again; do not create another payment.");
  return json(500, "The result could not be confirmed. Reload the correction history before retrying.");
}

export async function GET(request: Request) {
  try {
    const scope = await receiptCorrectionScope();
    const params = new URL(request.url).searchParams;
    if (params.has("document")) {
      const input = z.object({ document: z.cuid(), side: z.enum(["source", "target"]) }).strict().parse(Object.fromEntries(params));
      const doc = await receiptCorrectionDocument(scope, input.document, input.side);
      return await protectDlpResponse(new Response(doc.content, { headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="STOR24-receipt-correction-${input.side}.html"`, "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" } }), { organisationId: scope.organisationId, facilityId: doc.facilityId, actorId: scope.userId, resourceId: doc.documentId });
    }
    const data = await receiptCorrectionWorkspace(scope, Object.fromEntries(params), await receiptCorrectionCapabilities(scope));
    return Response.json({ data }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Invalid request origin." } }, { status: 403, headers });
    await receiptCorrectionScope();
    const body = command.parse(await boundedBody(request));
    if (body.action === "preview") return Response.json({ data: await receiptCorrectionPreview(await receiptCorrectionScope(), body.input) }, { headers });
    if (body.action === "request") return Response.json({ data: await requestReceiptReallocation(await receiptCorrectionScope("request"), body.input, body.fingerprint) }, { headers });
    const scope = await receiptCorrectionScope(body.decision === "cancel" ? "request" : "approve");
    return Response.json({ data: await decideReceiptReallocation(scope, body.id, body.revision, body.decision, body.reference) }, { headers });
  } catch (error) { return failure(error); }
}
