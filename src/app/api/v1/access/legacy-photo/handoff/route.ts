import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { issueLegacyPhotoHandoff } from "@/lib/legacy-photo-handoff";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime="nodejs";
export async function POST(request:Request) {try{
  if(!sameOrigin(request)||Number(request.headers.get("content-length")??0)>1024)throw Error("FORBIDDEN");
  const scope=await requirePermissionScope("move_in.create");
  if(await rateLimit(`legacy-photo-handoff:${scope.organisationId}:${scope.userId}`,10,60_000))throw Error("PHOTO_RATE_LIMITED");
  const input=await request.json();
  if(!input||typeof input.tenancyId!=="string"||!Number.isSafeInteger(input.version)||input.version<0||input.identityConfirmed!==true)throw Error("PHOTO_IDENTITY_REQUIRED");
  const data=await issueLegacyPhotoHandoff(scope,input.tenancyId,input.version);
  return Response.json({data},{headers:tenantPrivateHeaders});
}catch(error){return facialPhotoError(error);}}
