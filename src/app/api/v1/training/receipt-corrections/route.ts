import { z } from "zod";
import { sameOrigin } from "@/lib/request-security";
import { receiptCorrectionScope, receiptCorrectionCapabilities } from "@/lib/receipt-reallocation-access";
import { receiptTrainingWorkspace, receiptTrainingAction } from "@/lib/receipt-correction-training-service";
import { receiptTrainingCommand } from "@/lib/receipt-correction-training-policy";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };
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
  const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "FACILITY_FORBIDDEN"].includes(code) ? 403 : code === "REALLOCATION_NOT_FOUND" ? 404 : error instanceof z.ZodError || error instanceof SyntaxError || code === "REALLOCATION_BODY" ? 400 : code.startsWith("REALLOCATION_") ? 409 : 500;
  return Response.json({ error: { message: status === 401 ? "Sign in to receipt training." : status === 403 ? "Your current role cannot use receipt training for this store." : status === 400 ? "Check the training request. Approval, posting and undo are unavailable here." : "Training records could not be confirmed. Refresh before retrying. No live financial record was changed." } }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const scope = await receiptCorrectionScope(), capabilities = await receiptCorrectionCapabilities(scope);
    return Response.json({ data: await receiptTrainingWorkspace(scope, Object.fromEntries(new URL(request.url).searchParams), capabilities.canRequest) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    await receiptCorrectionScope();
    const command = receiptTrainingCommand.parse(await boundedBody(request));
    const scope = await receiptCorrectionScope(command.action === "preview" ? "view" : "request");
    return Response.json({ data: await receiptTrainingAction(scope, command) }, { headers });
  } catch (error) { return failure(error); }
}
