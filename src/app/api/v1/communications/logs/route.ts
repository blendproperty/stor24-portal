import { requirePermissionScope } from "@/lib/scope";
import { apiError } from "@/lib/api";
import { readCommunicationQuery } from "@/lib/communication-log-query";
import { communicationLogPage } from "@/lib/communication-log-service";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const { filters, cursor } = readCommunicationQuery(new URL(request.url).searchParams);
    return Response.json({ data: await communicationLogPage(scope, filters, cursor) }, { headers });
  } catch (failure) {
    if (failure instanceof Error && ["COMMUNICATION_FILTER_INVALID", "COMMUNICATION_CURSOR_INVALID"].includes(failure.message)) return Response.json({ error: { message: failure.message === "COMMUNICATION_CURSOR_INVALID" ? "This page reference no longer matches the filters or your access. Refresh the messages." : "Choose valid filters. The from date must be on or before the to date." } }, { status: 422, headers });
    const response = apiError(failure);
    if (response.status === 500) return Response.json({ error: { code: "INTERNAL_ERROR", message: "Message history could not be read. Refresh messages to try again." } }, { status: 500, headers });
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response;
  }
}
