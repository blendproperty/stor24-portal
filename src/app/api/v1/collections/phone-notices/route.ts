import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { phoneChannel, phoneCommand } from "@/lib/collection-phone-policy";
import { actPhoneNotice, previewPhoneNotice } from "@/lib/collection-phone-service";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
function failure(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "COLLECTION_NOT_FOUND"].includes(code) ? 403 : e instanceof z.ZodError || e instanceof SyntaxError || ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(code) ? 400 : code.startsWith("COLLECTION_PHONE_") || e && typeof e === "object" && "code" in e && ["P2002", "P2034"].includes(String(e.code)) ? 409 : 500;
  return Response.json({ error: status === 401 ? "Sign in is required." : status === 403 ? "Permission at this store is required." : status === 400 ? "Check the account, channel, confirmation and review reference." : "The notice is held or changed. Reload and review its current source, consent, independent approval and channel configuration. Do not retry an uncertain send." }, { status, headers });
}
export async function GET(request: Request) {
  try { const scope = await requirePermissionScope("collections.view"), params = new URL(request.url).searchParams;
    return Response.json(await previewPhoneNotice(scope, z.cuid().parse(params.get("accountId")), phoneChannel.parse(params.get("channel"))), { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("collections.manage"), command = phoneCommand.parse(JSON.parse((await boundedBody(new Response(request.body), 4000)).toString()));
    if (await rateLimit(`collection-phone:${scope.organisationId}:${scope.userId}`, 20, 60000)) return Response.json({ error: "Wait a minute before more notice actions." }, { status: 429, headers });
    return Response.json(await actPhoneNotice(scope, command), { headers });
  } catch (e) { return failure(e); }
}
