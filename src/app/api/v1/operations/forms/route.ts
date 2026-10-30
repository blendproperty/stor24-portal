import { z } from "zod";
import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { formChangeSchema } from "@/lib/operational-form-policy";
import { createOperationalForm,changeOperationalForm,operationalForms } from "@/lib/operational-form-service";

const headers = { "Cache-Control": "private, no-store" };
const messages: Record<string,string> = { FORM_INVALID: "Review the field values and dates.",FORM_INCOMPLETE: "Complete the required fields before submitting.",FORM_DATE_ORDER: "The end date or time must not precede the start.",FORM_APPROVAL_REQUIRED: "This action is off until the required business rules are agreed. Draft review is not approval to act.",FORM_REVIEWER_REQUIRED: "Choose a separate manager with current access to this store.",FORM_INVALID_PHOTO: "Use up to three JPEG photographs, each under 300 KB after resizing, with no more than 10 million pixels.",FORM_LIMIT: "The staff limit was reached. Contact your administrator." };
function failure(error: unknown) {
  if (error instanceof Error && error.message === "MFA_REQUIRED") return Response.json({ error: { message: "Complete two-step verification before using forms." } },{ status: 403,headers });
  if (error instanceof z.ZodError || error instanceof Error && messages[error.message]) return Response.json({ error: { message: error instanceof z.ZodError ? error.issues[0]?.message : messages[error.message] } },{ status: 422,headers });
  if (error instanceof Error && error.message === "INVALID_JSON") return Response.json({ error: { message: "Send a valid form of no more than 2 MB." } },{ status: 422,headers });
  const response = apiError(error);response.headers.set("Cache-Control","private, no-store");return response;
}
async function body(request: Request) {
  if (Number(request.headers.get("content-length")) > 2000000) throw Error("INVALID_JSON");
  const reader = request.body?.getReader();if (!reader) throw Error("INVALID_JSON");
  const decoder = new TextDecoder("utf-8",{ fatal: true }),chunks: string[] = [];let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 2000000) { await reader.cancel();throw Error("INVALID_JSON"); }
      chunks.push(decoder.decode(chunk.value,{ stream: true }));
    }
    chunks.push(decoder.decode());
  } catch { throw Error("INVALID_JSON"); } finally { reader.releaseLock(); }
  const text = chunks.join("");
  try { return JSON.parse(text); } catch { throw Error("INVALID_JSON"); }
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view"),params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw Error("INVALID_JSON");
    const query = z.object({ id: z.string().cuid().optional(),facilityId: z.string().cuid().optional(),cursor: z.string().cuid().optional(),closed: z.enum(["true","false"]).optional() }).strict().parse(Object.fromEntries(params));
    return Response.json({ data: await operationalForms(scope,{ ...query,closed: query.closed === "true" }) },{ headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view");
    return Response.json({ data: await createOperationalForm(scope,await body(request)) },{ headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("operations.view");
    return Response.json({ data: await changeOperationalForm(scope,formChangeSchema.parse(await body(request))) },{ headers });
  } catch (error) { return failure(error); }
}
