import { z } from "zod";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { operationalNoticeLibrary, saveOperationalTemplate, previewOperationalNotice, prepareOperationalNotice, reviewOperationalNotice, sendOperationalNotice } from "@/lib/operational-notice-service";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff"};
function failure(e:unknown){
  const code=e instanceof Error?e.message:"",conflict=!!(e&&typeof e==="object"&&"code" in e&&["P2002","P2034"].includes(String(e.code)));
  const status=code==="UNAUTHENTICATED"?401:["FORBIDDEN","FACILITY_FORBIDDEN","MFA_REQUIRED","NOTICE_NOT_FOUND","NOTICE_SELF_APPROVAL"].includes(code)?403:e instanceof z.ZodError||e instanceof SyntaxError||code.startsWith("MANDATE_RESPONSE_")?400:code.startsWith("NOTICE_")||conflict?409:500;
  return Response.json({error:code==="NOTICE_SELF_APPROVAL"?"Another authorised colleague who did not edit this template or prepare this notice must approve it.":status===401?"Sign in is required.":status===403?"Current permission for this store is required.":status===400?"Check the notice, variables, exact audience and confirmation.":status===409?"The template, recipients, consent or notice changed, or delivery is held. Reload and review before continuing.":"Unable to complete this action. Reload the saved notice before retrying."},{status,headers});
}
export async function GET(request:Request){try{
  const scope=await requirePermissionScope("operations.view"),params=new URL(request.url).searchParams,facilityId=params.get("facilityId");
  const facilities=await db.facility.findMany({where:facilityWhere(scope),select:{id:true,name:true},orderBy:{name:"asc"}});
  if(!facilityId)return Response.json({facilities},{headers});
  const id=z.string().min(1).max(100).parse(facilityId),search=z.string().max(100).parse(params.get("search")??"");
  let canManage=false,canSend=false;try{await requirePermissionScope("operations.manage",id);canManage=true}catch{/* read only */}try{await requirePermissionScope("billing.documents.send",id);canSend=canManage}catch{/* no send grant */}
  return Response.json({facilities,...await operationalNoticeLibrary(scope,id,search),canManage,canSend},{headers});
}catch(e){return failure(e)}}
const command=z.object({action:z.enum(["save-template","preview","prepare","approve","cancel","send"]),facilityId:z.string().min(1).max(100),input:z.unknown()}).strict();
export async function POST(request:Request){try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("operations.view"),c=command.parse(JSON.parse((await boundedBody(new Response(request.body),60000)).toString()));
  if(await rateLimit(`operational-notice:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:"Wait a minute before further notice actions."},{status:429,headers});
  const data=c.action==="save-template"?await saveOperationalTemplate(scope,c.facilityId,c.input):c.action==="preview"?await previewOperationalNotice(scope,c.facilityId,c.input):c.action==="prepare"?await prepareOperationalNotice(scope,c.facilityId,c.input):c.action==="send"?await sendOperationalNotice(scope,c.facilityId,c.input):await reviewOperationalNotice(scope,c.facilityId,{...z.record(z.string(),z.unknown()).parse(c.input),action:c.action});
  return Response.json({data},{headers});
}catch(e){return failure(e)}}
