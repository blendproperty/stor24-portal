import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin,rateLimit} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {submitReviewedDebiCheckTest,reconcileDebiCheckTest} from '@/lib/payments/netcash-debicheck-test-worker';

export const maxDuration=300;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('submit-test'),facilityId:z.string().cuid(),accountId:z.string().cuid(),consentId:z.string().regex(/^debicheck-bank-consent:[a-f\d-]{36}$/),confirmation:z.literal('SUBMIT ONE BANK TEST')}).strict(),
 z.object({action:z.literal('read-status'),facilityId:z.string().cuid(),accountId:z.string().cuid(),attemptId:z.string().regex(/^debicheck-attempt:[a-f\d-]{36}$/),confirmed:z.literal(true)}).strict(),
]);
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof Error&&error.message==='MANDATE_RESPONSE_TOO_LARGE')return Response.json({error:{message:'Check the saved account, original record and exact confirmation.'}},{status:422,headers});
 if(error instanceof Error&&/^(DEBICHECK|CARD_AUTOPAY|BILLING|RENT_REVIEW)_/.test(error.message))return Response.json({error:{code:error.message,message:'The original request, current permission or approved test source needs review. Read retained authentication history before continuing. No automatic resubmission is allowed.'}},{status:409,headers});
 if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:{message:'Another action changed this request. Read retained authentication history; do not repeat a bank request.'}},{status:409,headers});
 const response=authErrorResponse(error);for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
/** No GET/cron/queued replay entry point. Status reads and bank requests are
 * distinct explicit operations with distinct current permissions and flags. */
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('FORBIDDEN');
 const body=input.parse(JSON.parse((await boundedBody(new Response(request.body),4096)).toString()));
 const scope=await requirePermissionScope(body.action==='submit-test'?'payments.bank_auth_submit':'payments.bank_auth_status',body.facilityId);
 if(await rateLimit(`debicheck-test-action:${scope.organisationId}:${scope.userId}`,4,60000))return Response.json({error:{message:'Wait a minute, then read the retained history before continuing.'}},{status:429,headers});
 const data=body.action==='submit-test'?await submitReviewedDebiCheckTest(scope,{facilityId:body.facilityId,accountId:body.accountId,consentId:body.consentId,confirmed:true}):await reconcileDebiCheckTest(scope,body);
 return Response.json({data},{headers});
}catch(error){return failure(error)}}
