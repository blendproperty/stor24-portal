import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope, type RequestScope } from "@/lib/scope";
import { primaryTrialPolicy } from "@/lib/unit58-primary-photo-trial";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { previewLegacyPhoto, reviewLegacyPhoto, submitAssistedLegacyPhoto, withdrawAssistedLegacyPhoto } from "@/lib/legacy-access-photo";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { facialPhotoError } from "@/lib/facial-photo-response";

export const runtime="nodejs";
export const dynamic="force-dynamic";
async function trialPhoto(scope:RequestScope,id:string,allowWithdrawal=false) {
  const photo=await db.legacyAccessPhoto.findFirst({where:{id,tenancy:{facility:facilityWhere(scope)}},select:{tenancyId:true,policyVersion:true}});
  if(!photo || (allowWithdrawal ? !photo.policyVersion.startsWith("unit58-primary-photo-only-trial-") : !(await primaryTrialPolicy(db,scope.organisationId,photo.tenancyId))))throw Error("FORBIDDEN");
  return photo;
}
export async function GET(request:Request) {try{
  const scope=await requirePermissionScope("move_in.create"),url=new URL(request.url),id=url.searchParams.get("id")??"";
  await trialPhoto(scope,id);
  const bytes=await previewLegacyPhoto(scope,id,Number(url.searchParams.get("version")));
  return await protectDlpResponse(new Response(new Uint8Array(bytes),{headers:{...tenantPrivateHeaders,"Content-Type":"image/jpeg","Content-Disposition":"inline","Content-Security-Policy":"default-src 'none'; sandbox"}}),{organisationId:scope.organisationId,actorId:scope.userId,resourceId:id});
}catch(error){return facialPhotoError(error);}}
export async function POST(request:Request) {try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");
  const scope=await requirePermissionScope("move_in.create"),url=new URL(request.url),action=url.searchParams.get("action");
  if(action==="assisted-submit") {
    if(await rateLimit(`legacy-trial-face:${scope.organisationId}:${scope.userId}`,10,60000))throw Error("PHOTO_RATE_LIMITED");
    const form=await boundedPhotoForm(request),tenancyId=String(form.get("tenancyId")??""),image=form.get("image");
    if(!(await primaryTrialPolicy(db,scope.organisationId,tenancyId)))throw Error("FORBIDDEN");
    if(!(image instanceof File))throw Error("PHOTO_INVALID");
    const data=await submitAssistedLegacyPhoto(scope,{tenancyId,policyHash:String(form.get("policyHash")??""),customerConsent:form.get("customerConsent")==="on",identityChecked:form.get("identityChecked")==="on",expectedVersion:Number(form.get("version")),image});
    return Response.json({data},{status:201,headers:tenantPrivateHeaders});
  }
  if(action==="assisted-withdraw") {
    const form=await boundedPhotoForm(request),tenancyId=String(form.get("tenancyId")??"");
    const photo=await db.legacyAccessPhoto.findFirst({where:{tenancyId,tenancy:{facility:facilityWhere(scope)}},select:{id:true}});
    if(!photo)throw Error("FORBIDDEN");await trialPhoto(scope,photo.id,true);
    await withdrawAssistedLegacyPhoto(scope,tenancyId,Number(form.get("version")),form.get("identityChecked")==="on");
    return Response.json({data:{withdrawn:true}},{headers:tenantPrivateHeaders});
  }
  const decision=url.searchParams.get("decision"),id=url.searchParams.get("id")??"";
  if(decision!=="APPROVE"&&decision!=="REJECT")throw Error("PHOTO_CHANGED");
  await trialPhoto(scope,id);await reviewLegacyPhoto(scope,id,Number(url.searchParams.get("version")),decision);
  return Response.json({data:{reviewed:true}},{headers:tenantPrivateHeaders});
}catch(error){return facialPhotoError(error);}}
