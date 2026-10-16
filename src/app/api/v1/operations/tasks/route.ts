import { z } from "zod";
import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { operationsTaskQuerySchema } from "@/lib/operations-task-policy";
import { operationsTaskPage } from "@/lib/operations-task-service";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("operations.view"), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new SyntaxError();
    const query = operationsTaskQuerySchema.parse(Object.fromEntries(params));
    return Response.json({ data: await operationsTaskPage(scope, query) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: { message: "Check the task filters and reload the queue." } }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
    const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
