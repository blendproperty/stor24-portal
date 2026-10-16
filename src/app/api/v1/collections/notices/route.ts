import {z} from "zod";
import {requirePermissionScope} from "@/lib/scope";
import {sameOrigin,rateLimit} from "@/lib/request-security";
import {boundedBody} from "@/lib/payments/netcash-mandate";
import {previewCollectionNotice,prepareCollectionNotice,reviewCollectionNotice,sendCollectionNotice} from "@/lib/collection-notice-service";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
const messages:Record<string,string>={COLLECTION_NOT_FOUND:"This account is outside your permitted stores.",COLLECTION_NOTICE_NOT_FOUND:"The notice is unavailable in your scope.",COLLECTION_NOTICE_CHANGED:"The account, consent, message or notice changed. Reload and review it again.",COLLECTION_NOTICE_HOLD:"Resolve the collection, identity or consent holds before preparing a notice.",COLLECTION_NOTICE_IMMUTABLE:"This notice cannot be changed or resent in its current stage.",COLLECTION_NOTICE_SELF_APPROVAL:"Another authorised colleague must review and approve this notice.",COLLECTION_NOTICE_CONFIG:"The existing email provider must be configured before sending.",COLLECTION_NOTICE_INTEGRITY:"The saved message failed integrity checks. Administrator review is required."};
function failure(e:unknown){const code=e instanceof Error?e.message:"";const status=code==="UNAUTHENTICATED"?401:["FORBIDDEN","COLLECTION_NOT_FOUND","COLLECTION_NOTICE_NOT_FOUND","COLLECTION_NOTICE_SELF_APPROVAL"].includes(code)?403:e instanceof z.ZodError||e instanceof SyntaxError||["MANDATE_RESPONSE_TOO_LARGE","MANDATE_RESPONSE_INVALID"].includes(code)?400:messages[code]||(e&&typeof e==="object"&&"code"in e&&["P2002","P2034"].includes(String(e.code)))?409:500;return Response.json({error:messages[code]??(status===401?"Sign in is required.":status===403?"Permission required.":status===400?"Check the selected account, review reference and confirmation.":"Unable to complete this action. Reload the saved notice before retrying.")},{status,headers})}
export async function GET(request:Request){try{const scope=await requirePermissionScope("collections.view"),accountId=z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("accountId"));const preview=await previewCollectionNotice(scope,accountId);let canManage=false,canSend=false;try{await requirePermissionScope("collections.manage",preview.source.facilityId);canManage=true}catch{/* view only */}try{await requirePermissionScope("billing.documents.send",preview.source.facilityId);canSend=canManage&&!preview.notice?.scheduledRunId}catch{/* no sending grant */}return Response.json({...preview,canManage,canSend},{headers})}catch(e){return failure(e)}}
const commandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("prepare"),accountId:z.string().min(1).max(100),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.enum(["approve","reopen","cancel"]),accountId:z.string().min(1).max(100),id:z.string().min(1).max(120),revision:z.string().uuid(),reference:z.string().trim().min(3).max(240)}).strict(),
  z.object({action:z.literal("send"),accountId:z.string().min(1).max(100),id:z.string().min(1).max(120),revision:z.string().uuid(),confirm:z.literal(true)}).strict(),
]);
export async function POST(request:Request){try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("collections.manage");const input=commandSchema.parse(JSON.parse((await boundedBody(new Response(request.body),4000)).toString()));
  if(await rateLimit(`collection-notice:${scope.organisationId}:${scope.userId}`,20,60000))return Response.json({error:"Wait a minute before more notice actions."},{status:429,headers});
  const preview=await previewCollectionNotice(scope,input.accountId);
  if(input.action==="prepare")await prepareCollectionNotice(scope,input.accountId,input.fingerprint);
  else{if(preview.notice?.id!==input.id)throw Error("COLLECTION_NOTICE_CHANGED");if(input.action==="send"){await requirePermissionScope("billing.documents.send",preview.source.facilityId);await sendCollectionNotice(scope,{id:input.id,revision:input.revision,confirm:input.confirm})}else await reviewCollectionNotice(scope,{action:input.action,id:input.id,revision:input.revision,reference:input.reference})}
  return Response.json(await previewCollectionNotice(scope,input.accountId),{headers});
}catch(e){return failure(e)}}
