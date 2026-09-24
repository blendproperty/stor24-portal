import { apiError } from "@/lib/api";
import { listLeasing } from "@/lib/leasing-service";
import { requirePermissionScope } from "@/lib/scope";

export async function GET() {
  try { return Response.json({ data: await listLeasing(await requirePermissionScope("operations.view")) }); }
  catch (error) { return apiError(error); }
}
