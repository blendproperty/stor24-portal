import { requirePermissionScope } from "@/lib/scope";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { previewLegacyPhoto, reviewLegacyPhoto } from "@/lib/legacy-access-photo";
import { facialPhotoError } from "@/lib/facial-photo-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {try{const scope=await requirePermissionScope("access.manage"),url=new URL(request.url),id=url.searchParams.get("id")??"";const bytes=await previewLegacyPhoto(scope,id,Number(url.searchParams.get("version")));return await protectDlpResponse(new Response(new Uint8Array(bytes),{headers:{...tenantPrivateHeaders,"Content-Type":"image/jpeg","Content-Disposition":"inline","Content-Security-Policy":"default-src 'none'; sandbox"}}),{organisationId:scope.organisationId,actorId:scope.userId,resourceId:id});}catch(error){return facialPhotoError(error);}}
export async function POST(request:Request) {try{if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("access.manage"),url=new URL(request.url),decision=url.searchParams.get("decision");if(decision!=="APPROVE"&&decision!=="REJECT")throw Error("PHOTO_CHANGED");await reviewLegacyPhoto(scope,url.searchParams.get("id")??"",Number(url.searchParams.get("version")),decision);return Response.json({data:{reviewed:true}},{headers:tenantPrivateHeaders});}catch(error){return facialPhotoError(error);}}
