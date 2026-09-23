import { requireSession, authErrorResponse } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { trainingActionSchema } from "@/lib/move-in-training-contract";
import { trainingSnapshot, trainingCommand, trainingSample, validateTrainingSample } from "@/lib/move-in-training";
const headers = { "Cache-Control":"no-store, private", "X-Content-Type-Options":"nosniff" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string,string> = { TRAINING_DISABLED:"The owner has switched training off.", TRAINING_CHANGED:"Training changed. Refresh before continuing.", TRAINING_STEP_REQUIRED:"Complete the preceding checks and required confirmation first.", TRAINING_FINISHED:"This training run is complete.", TRAINING_SAMPLE_REQUIRED:"Use the supplied training image only. Real customer photos are not accepted here.", PHOTO_INVALID:"Choose the supplied PNG training image (maximum 5 MB)." };
  return messages[code] ? Response.json({error:{message:messages[code]}},{status:409,headers}) : authErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const auth = await requireSession(); const url = new URL(request.url);
    const data = await trainingSnapshot(auth.user.id,url.searchParams.get("facility") ?? undefined);
    if (url.searchParams.get("sample") === "true") {
      if (!data.enabled) throw new Error("TRAINING_DISABLED");
      return new Response(new Uint8Array(await trainingSample()),{headers:{...headers,"Content-Type":"image/png","Content-Disposition":'attachment; filename="stor24-training.png"'}});
    }
    return Response.json({data},{headers});
  } catch(error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const auth = await requireSession();
    // Authorise before decoding any uploaded content.
    const access = await trainingSnapshot(auth.user.id);
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (!access.enabled) throw new Error("TRAINING_DISABLED");
      const form = await boundedPhotoForm(request), image = form.get("image");
      const input = trainingActionSchema.parse({action:"photo",facilityId:form.get("facilityId"),version:Number(form.get("version"))});
      if (!(image instanceof File)) throw new Error("TRAINING_SAMPLE_REQUIRED");
      await validateTrainingSample(image);
      return Response.json({data:await trainingCommand(auth.user.id,input,true)},{headers});
    }
    return Response.json({data:await trainingCommand(auth.user.id,trainingActionSchema.parse(await request.json()))},{headers});
  } catch(error) { return errorResponse(error); }
}
