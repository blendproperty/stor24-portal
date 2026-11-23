import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { legacyPhotoHandoff, captureLegacyPhotoHandoff } from "@/lib/legacy-photo-handoff";
import { captureHikCentralFaceHandoff, hikCentralFaceHandoff } from "@/lib/hikcentral-face-capture";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime="nodejs";
export async function POST(request:Request) {try{
  if(!publicApiAuthorized(request))throw Error("FORBIDDEN");
  const ip=request.headers.get("x-stor24-client-ip")?.slice(0,128)||requestIp(request);
  if(await rateLimit(`legacy-photo-public:${privacyHash(ip)}`,20,60_000))throw Error("PHOTO_RATE_LIMITED");
  if(request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form=await boundedPhotoForm(request),image=form.get("image");
    if(!(image instanceof File))throw Error("PHOTO_INVALID");
    const token=String(form.get("token")??"");
    const input={policyHash:String(form.get("policyHash")??""),consent:form.get("consent")==="on",image};
    if(await db.hikCentralFaceHandoff.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{id:true}}))await captureHikCentralFaceHandoff(token,input);
    else await captureLegacyPhotoHandoff(token,input);
    return Response.json({data:{captured:true}},{status:201,headers:tenantPrivateHeaders});
  }
  if(Number(request.headers.get("content-length")??0)>1024)throw Error("PHOTO_CHANGED");
  const input=await request.json();
  const token=String(input?.token??"");
  const data=await db.hikCentralFaceHandoff.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{id:true}})?await hikCentralFaceHandoff(token):await legacyPhotoHandoff(token);
  return Response.json({data},{headers:tenantPrivateHeaders});
}catch(error){return facialPhotoError(error);}}
