import { requirePermissionScope } from "@/lib/scope";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { previewLegacyPhoto, reviewLegacyPhoto, submitAssistedLegacyPhoto, withdrawAssistedLegacyPhoto } from "@/lib/legacy-access-photo";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { rateLimit } from "@/lib/request-security";
import { facialPhotoError } from "@/lib/facial-photo-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {try{const scope=await requirePermissionScope("access.manage"),url=new URL(request.url),id=url.searchParams.get("id")??"";const bytes=await previewLegacyPhoto(scope,id,Number(url.searchParams.get("version")));return await protectDlpResponse(new Response(new Uint8Array(bytes),{headers:{...tenantPrivateHeaders,"Content-Type":"image/jpeg","Content-Disposition":"inline","Content-Security-Policy":"default-src 'none'; sandbox"}}),{organisationId:scope.organisationId,actorId:scope.userId,resourceId:id});}catch(error){return facialPhotoError(error);}}
export async function POST(request:Request) {try{if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("access.manage"),url=new URL(request.url);
  if(url.searchParams.get("action")==="assisted-submit") {if(await rateLimit(`legacy-face:${scope.organisationId}:${scope.userId}`,10,60000))throw Error("PHOTO_RATE_LIMITED");const form=await boundedPhotoForm(request),image=form.get("image");if(!(image instanceof File))throw Error("PHOTO_INVALID");const data=await submitAssistedLegacyPhoto(scope,{tenancyId:String(form.get("tenancyId")??""),policyHash:String(form.get("policyHash")??""),customerConsent:form.get("customerConsent")==="on",identityChecked:form.get("identityChecked")==="on",expectedVersion:Number(form.get("version")),image});return Response.json({data},{status:201,headers:tenantPrivateHeaders});}
  if(url.searchParams.get("action")==="assisted-withdraw") {const form=await boundedPhotoForm(request);await withdrawAssistedLegacyPhoto(scope,String(form.get("tenancyId")??""),Number(form.get("version")),form.get("identityChecked")==="on");return Response.json({data:{withdrawn:true}},{headers:tenantPrivateHeaders});}
  const decision=url.searchParams.get("decision");if(decision!=="APPROVE"&&decision!=="REJECT")throw Error("PHOTO_CHANGED");await reviewLegacyPhoto(scope,url.searchParams.get("id")??"",Number(url.searchParams.get("version")),decision);return Response.json({data:{reviewed:true}},{headers:tenantPrivateHeaders});}catch(error){return facialPhotoError(error);}}
