import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin,rateLimit} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {prepareRefundSend,reviewRefundSend,sendRefundRequest,refundSendHistory} from '@/lib/payments/netcash-refund-request-service';
export const maxDuration=120;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const selection={facilityId:z.string().cuid(),refundId:z.string().regex(/^netcash-refund:[a-f\d]{64}$/),reservationRevision:z.number().int().positive()};
const action={...selection,reference:z.string().trim().min(3).max(200).regex(/^[^\x00-\x1f\x7f]+$/),confirmed:z.literal(true)};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare-send'),...action,confirmation:z.literal('PREPARE REFUND REQUEST')}).strict(),
 z.object({action:z.literal('review-send'),...action,attemptRevision:z.number().int().positive(),confirmation:z.literal('APPROVE REFUND REQUEST')}).strict(),
 z.object({action:z.literal('send'),...action,attemptRevision:z.number().int().positive(),confirmation:z.literal('REQUEST NETCASH REFUND')}).strict(),
]);
const permissions={'prepare-send':'payments.refund_send','review-send':'payments.refund_send_review',send:'payments.refund_send'}as const;
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof Error&&['MANDATE_RESPONSE_TOO_LARGE','MANDATE_RESPONSE_INVALID'].includes(error.message))return Response.json({error:{message:'Check the original reservation, separate SEND review and exact confirmation.'}},{status:422,headers});
 if(error instanceof Error&&/^(NETCASH_REFUND|ADJUSTMENT|RECEIPT_REVIEW|SETTLEMENT)_/.test(error.message))return Response.json({error:{code:error.message,message:'This refund request needs review. Refresh retained history before continuing. A committed claim or unknown provider outcome must never be retried.'}},{status:409,headers});
 if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:{message:'Another action changed this request. Refresh retained history; do not resubmit a claimed refund.'}},{status:409,headers});
 const response=authErrorResponse(error);for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('adjustments.view'),params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new SyntaxError();
 const input=z.object({facilityId:selection.facilityId,refundId:selection.refundId}).strict().parse(Object.fromEntries(params));
 if(await rateLimit(`netcash-refund-send-read:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:{message:'Wait a minute before refreshing again.'}},{status:429,headers});
 return Response.json({data:await refundSendHistory(scope,input.facilityId,input.refundId)},{headers});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('FORBIDDEN');await requirePermissionScope('adjustments.view');
 const input=schema.parse(JSON.parse((await boundedBody(new Response(request.body),4096)).toString())),scope=await requirePermissionScope(permissions[input.action]);
 if(await rateLimit(`netcash-refund-send-write:${scope.organisationId}:${scope.userId}`,4,60000))return Response.json({error:{message:'Wait a minute and review retained history before continuing.'}},{status:429,headers});
 const data=input.action==='prepare-send'?await prepareRefundSend(scope,input):input.action==='review-send'?await reviewRefundSend(scope,input):await sendRefundRequest(scope,input);
 return Response.json({data},{status:input.action==='send'?202:200,headers});
}catch(error){return failure(error);}}
