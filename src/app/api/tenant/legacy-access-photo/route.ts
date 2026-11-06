import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { legacyPhotoStatus, submitLegacyPhoto, withdrawLegacyPhoto } from "@/lib/legacy-access-photo";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {try{return Response.json({data:await legacyPhotoStatus(await requireTenantSession(),new URL(request.url).searchParams.get("tenancyId")??"")},{headers:tenantPrivateHeaders});}catch(error){return facialPhotoError(error);}}
export async function POST(request:Request) {try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");const session=await requireTenantSession();
  if(await tenantRateLimit(`face-upload:${session.organisationId}:${session.email.toLowerCase()}`,5,60000))throw Error("PHOTO_RATE_LIMITED");
  const form=await boundedPhotoForm(request),image=form.get("image");if(!(image instanceof File))throw Error("PHOTO_INVALID");
  const data=await submitLegacyPhoto(session,{tenancyId:String(form.get("tenancyId")??""),policyHash:String(form.get("policyHash")??""),consent:form.get("consent")==="on",expectedVersion:Number(form.get("version")),image});
  return Response.json({data},{status:201,headers:tenantPrivateHeaders});
}catch(error){return facialPhotoError(error);}}
export async function DELETE(request:Request) {try{if(!sameOrigin(request))throw Error("FORBIDDEN");const url=new URL(request.url);await withdrawLegacyPhoto(await requireTenantSession(),url.searchParams.get("tenancyId")??"",Number(url.searchParams.get("version")));return Response.json({data:{withdrawn:true}},{headers:tenantPrivateHeaders});}catch(error){return facialPhotoError(error);}}
