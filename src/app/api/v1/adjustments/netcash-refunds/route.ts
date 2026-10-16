import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin,rateLimit} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {previewNetcashRefund,prepareNetcashRefund,actOnNetcashRefund,netcashRefundHistory,netcashRefundOptions} from '@/lib/payments/netcash-refund-service';
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const id=z.string().cuid(),recordId=z.string().regex(/^netcash-refund:[a-f\d]{64}$/),reference=z.string().trim().min(3).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const source={facilityId:id,adjustmentId:id,lineId:id},action={facilityId:id,id:recordId,revision:z.number().int().min(1),reference,confirmed:z.literal(true)};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),...source}).strict(),
 z.object({action:z.literal('prepare'),...source,previewHash:z.string().regex(/^[a-f\d]{64}$/),reference,confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('review'),...action}).strict(),z.object({action:z.literal('reject'),...action}).strict(),z.object({action:z.literal('withdraw'),...action}).strict(),
 z.object({action:z.literal('reserve'),...action,confirmation:z.literal('RESERVE WITHOUT DISPATCH')}).strict(),
 z.object({action:z.literal('request-release'),...action,confirmation:z.literal('REQUEST LOCAL HOLD RELEASE')}).strict(),
 z.object({action:z.literal('approve-release'),...action,confirmation:z.literal('RELEASE LOCAL HOLD')}).strict(),
]);
const permission={preview:'payments.refund_prepare',prepare:'payments.refund_prepare',review:'payments.refund_review',reject:'payments.refund_review',withdraw:'payments.refund_prepare',reserve:'payments.refund_reserve','request-release':'payments.refund_reserve','approve-release':'payments.refund_release_review'}as const;
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof Error&&['MANDATE_RESPONSE_TOO_LARGE','MANDATE_RESPONSE_INVALID'].includes(error.message)))return Response.json({error:{message:'Check the store, original refund, source and explicit confirmation.'}},{status:422,headers});
 if(error instanceof Error&&/^(NETCASH_REFUND|ADJUSTMENT|RECEIPT_REVIEW|SETTLEMENT)_/.test(error.message))return Response.json({error:{code:error.message,message:'The original payment, finance approval, retained reservation or possible provider outcome needs review. Refresh its history before continuing.'}},{status:409,headers});
 if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:{message:'Another action changed this source. Refresh its history before continuing.'}},{status:409,headers});
 const response=authErrorResponse(error);for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('adjustments.view'),params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new SyntaxError();
 const input=z.object({facilityId:id,mode:z.enum(['history','options']).default('history'),cursor:z.string().min(1).max(160).optional()}).strict().parse(Object.fromEntries(params));
 if(await rateLimit(`netcash-refund-read:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:{message:'Wait a minute before refreshing again.'}},{status:429,headers});
 return Response.json({data:input.mode==='options'?await netcashRefundOptions(scope,input.facilityId,input.cursor):await netcashRefundHistory(scope,input.facilityId,input.cursor)},{headers});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('FORBIDDEN');await requirePermissionScope('adjustments.view');
 const input=schema.parse(JSON.parse((await boundedBody(new Response(request.body),4096)).toString())),scope=await requirePermissionScope(permission[input.action]);
 if(await rateLimit(`netcash-refund-write:${scope.organisationId}:${scope.userId}`,10,60000))return Response.json({error:{message:'Wait a minute before continuing.'}},{status:429,headers});
 const data=input.action==='preview'?await previewNetcashRefund(scope,input):input.action==='prepare'?await prepareNetcashRefund(scope,input):await actOnNetcashRefund(scope,input);
 return Response.json({data},{headers});
}catch(error){return failure(error)}}
