import { authErrorResponse, requireSession } from "@/lib/auth-guards";
import { catalogueForAssignments } from "@/lib/guided-help-access";

export async function GET() {
  try {
    const auth = await requireSession();
    return Response.json({ data: catalogueForAssignments(auth.user.roleAssignments) }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (error) {
    const response = authErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
