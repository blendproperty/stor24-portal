import { apiError, jsonBody } from "@/lib/api";
import { giveNotice, moveIn, moveOut, transfer } from "@/lib/leasing-service";
import { dispatchBlendSignLease } from "@/lib/blendsign-lease-service";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { moveInSchema, moveOutSchema, noticeSchema, transferSchema } from "@/lib/validators";

const commands = { "move-in": [moveInSchema, moveIn], transfer: [transferSchema, transfer], notice: [noticeSchema, giveNotice], "move-out": [moveOutSchema, moveOut] } as const;
const permissions = { "move-in": "move_in.create", transfer: "operations.manage", notice: "collections.manage", "move-out": "operations.manage" } as const;

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const { action } = await context.params; const command = commands[action as keyof typeof commands]; if (!command) throw new Error("NOT_FOUND");
    const parsed = command[0].safeParse(await jsonBody(request)); if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted account details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const scope = await requirePermissionScope(permissions[action as keyof typeof permissions]);
    const data = await (command[1] as (s: typeof scope, i: never) => Promise<unknown>)(scope, parsed.data as never);
    if (action === "move-in") {
      const result = data as Awaited<ReturnType<typeof moveIn>>;
      await dispatchBlendSignLease(scope, result, parsed.data as never);
    }
    return Response.json({ data });
  } catch (error) { return apiError(error); }
}
