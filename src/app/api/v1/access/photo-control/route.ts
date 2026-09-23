import { z } from "zod";
import { requireSession, authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { photoControlSnapshot, setPhotoCollection } from "@/lib/facial-photo-control";
const headers={"Cache-Control":"no-store, private"};
export const dynamic="force-dynamic";
export async function GET() {
  try { const scope=await requirePermissionScope("access.view"); return Response.json({data:await photoControlSnapshot(scope.organisationId,scope.userId)},{headers}); }
  catch(error) { return authErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const auth=await requireSession();
    const input=z.object({enabled:z.boolean(),version:z.number().int().min(0)}).strict().parse(await request.json());
    return Response.json({data:await setPhotoCollection(auth.user.id,input.enabled,input.version)},{headers});
  } catch(error) {
    const code=error instanceof Error ? error.message : "";
    const message=code==="PHOTO_CONTROL_CHANGED" ? "This setting changed. Refresh before trying again." : code==="PHOTO_SETUP_REQUIRED" ? "Secure storage and the photo deletion service must be ready before collection can open." : null;
    return message ? Response.json({error:{message}},{status:409,headers}) : authErrorResponse(error);
  }
}
