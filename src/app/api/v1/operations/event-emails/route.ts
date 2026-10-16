import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { staffEmailCommand, staffEmailQuery } from "@/lib/staff-event-email-policy";
import { STAFF_EMAIL_VIEW } from "@/lib/staff-event-email-source";
import { evaluateStaffEventEmail, prepareStaffEventEmail, previewStaffEventEmail, readStaffEventEmails, reviewStaffEventEmail } from "@/lib/staff-event-email-service";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
function failure(error: unknown) {
  const key = error instanceof Error ? error.message : "";
  const status = (key === "UNAUTHORIZED" || key === "UNAUTHENTICATED") ? 401 : key === "FORBIDDEN" || key.endsWith("FORBIDDEN") ? 403 : key === "STAFF_EMAIL_NOT_FOUND" ? 404 : key.startsWith("STAFF_EMAIL_") ? 409 : 500;
  return Response.json({ error: { message: status === 401 ? "Sign in again." : status === 403 ? "Your current role does not allow this action." : status === 500 ? "The request could not be confirmed. Reload before trying again." : "Reload the current source, timing and review before continuing." } }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope(STAFF_EMAIL_VIEW);
    const parsed = staffEmailQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: { message: "Choose valid staff email filters." } }, { status: 422, headers });
    return Response.json({ data: await readStaffEventEmails(scope, parsed.data) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope(STAFF_EMAIL_VIEW);
    const parsed = staffEmailCommand.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { message: "Complete the store, recipients, events and South African dates." } }, { status: 422, headers });
    const command = parsed.data;
    const data = command.action === "preview" ? await previewStaffEventEmail(scope, command) : command.action === "prepare" ? await prepareStaffEventEmail(scope, command) : command.action === "review" ? await reviewStaffEventEmail(scope, command) : await evaluateStaffEventEmail(scope, command);
    return Response.json({ data }, { headers });
  } catch (error) { return failure(error); }
}
