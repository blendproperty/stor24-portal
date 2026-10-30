import {z} from "zod";
import {db} from "@/lib/db";
import {requirePermissionScope,facilityWhere} from "@/lib/scope";
import {sameOrigin,rateLimit} from "@/lib/request-security";
import {boundedBody} from "@/lib/payments/netcash-mandate";
import {maintenanceRegister,saveMaintenanceReport,certificateFollowup,visitorRegister,recordVisitor,updateVisitor} from "@/lib/operational-form-service";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff"};
function failure(e:unknown){const code=e instanceof Error?e.message:"",conflict=!!(e&&typeof e==="object"&&"code"in e&&["P2002","P2034"].includes(String(e.code)));const status=code==="UNAUTHENTICATED"?401:["FORBIDDEN","FACILITY_FORBIDDEN","MFA_REQUIRED","FORM_NOT_FOUND"].includes(code)?403:e instanceof z.ZodError||e instanceof SyntaxError||code.startsWith("MANDATE_RESPONSE_")?400:code.startsWith("FORM_")||conflict?409:500;return Response.json({error:status===401?"Sign in is required.":status===403?"Current permission for this store and record is required.":status===400?"Check the form fields, dates, acknowledgement and confirmation.":code==="FORM_COMPLETION_REQUIRED"?"Record the resolution date and outcome in the maintenance report before completing this request.":code==="FORM_FOLLOWUP_CHANGED"?"Review the existing certificate follow-up task before creating or changing another.":status===409?"The record changed or dates are inconsistent. Reload and review before continuing.":"Unable to confirm this action. Reload and check the register before retrying."},{status,headers});}
export async function GET(request:Request){try{
  const scope=await requirePermissionScope("operations.view"),p=new URL(request.url).searchParams,facilityId=p.get("facilityId");
  const facilities=await db.facility.findMany({where:{...facilityWhere(scope),active:true},select:{id:true,name:true},orderBy:{name:"asc"}});
  if(!facilityId)return Response.json({facilities},{headers});const id=z.cuid().parse(facilityId);if(!facilities.some(f=>f.id===id))throw Error("FORBIDDEN");
  let canManage=false;try{await requirePermissionScope("operations.manage",id);canManage=true}catch{/* read only */}
  const resource=z.enum(["maintenance","visitors"]).parse(p.get("resource")),cursor=z.string().max(100).parse(p.get("cursor")??"");
  const data=resource==="maintenance"?await maintenanceRegister(scope,id,cursor,z.string().max(160).parse(p.get("search")??""),z.union([z.literal(""),z.cuid()]).parse(p.get("maintenanceId")??"")):await visitorRegister(scope,id,z.iso.date().parse(p.get("date")),z.enum(["VISITOR","CLIENT_ATTENDANCE"]).parse(p.get("kind")),cursor);
  const units=resource==="visitors"?await db.unit.findMany({where:{facilityId:id,facility:{organisationId:scope.organisationId},combinedIntoUnitId:null},select:{id:true,number:true},orderBy:{number:"asc"}}):[];
  return Response.json({...data,facilities,canManage,units},{headers});
}catch(e){return failure(e)}}
export async function POST(request:Request){try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("operations.manage"),c=z.object({action:z.enum(["maintenance-save","certificate-followup","visitor-record","visitor-checkout","visitor-void"]),facilityId:z.cuid(),input:z.unknown()}).strict().parse(JSON.parse((await boundedBody(new Response(request.body),64000)).toString()));
  if(await rateLimit(`operational-form:${scope.organisationId}:${scope.userId}`,40,60000))return Response.json({error:"Wait a minute before further form actions."},{status:429,headers});
  const data=c.action==="maintenance-save"?await saveMaintenanceReport(scope,c.facilityId,c.input):c.action==="certificate-followup"?await certificateFollowup(scope,c.facilityId,c.input):c.action==="visitor-record"?await recordVisitor(scope,c.facilityId,c.input):await updateVisitor(scope,c.facilityId,{...z.record(z.string(),z.unknown()).parse(c.input),action:c.action==="visitor-checkout"?"checkout":"void"});
  return Response.json({data},{headers});
}catch(e){return failure(e)}}
