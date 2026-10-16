import { requireSession, authErrorResponse } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { createTrainingDebtor, trainingDebtors } from "@/lib/training-debtor-service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET() {
  try { const auth = await requireSession(); return Response.json({ data: await trainingDebtors(auth.user.id) }, { headers }); }
  catch (error) { return authErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const auth = await requireSession();
    return Response.json({ data: await createTrainingDebtor(auth.user.id, await request.json()) }, { headers });
  } catch (error) { return authErrorResponse(error); }
}
