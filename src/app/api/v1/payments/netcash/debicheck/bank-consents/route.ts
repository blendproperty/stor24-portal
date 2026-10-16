import { z } from 'zod';
import { requirePermissionScope } from '@/lib/scope';
import { authErrorResponse } from '@/lib/auth-guards';
import { sameOrigin,rateLimit } from '@/lib/request-security';
import { boundedBody } from '@/lib/payments/netcash-mandate';
import { listStaffBankConsents,reviewBankConsent } from '@/lib/payments/netcash-debicheck-bank-consent-service';

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof Error&&error.message==='MANDATE_RESPONSE_TOO_LARGE'))return Response.json({error:{message:'Check the store, request and confirmation.'}},{status:422,headers});
 if(error instanceof Error&&/^(DEBICHECK|CARD_AUTOPAY|BILLING|RENT_REVIEW)_/.test(error.message))return Response.json({error:{code:error.message,message:'The tenant consent, billing source, current template or independent review needs attention. No bank request or collection was submitted.'}},{status:409,headers});
 if(error&&typeof error==='object'&&'code' in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:{message:'Another action changed this request. Refresh before continuing.'}},{status:409,headers});
 if(error instanceof Error&&error.message==='FACILITY_FORBIDDEN')return Response.json({error:{message:'This store is outside your access.'}},{status:403,headers});
 const response=authErrorResponse(error);for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('payments.view'),params=new URL(request.url).searchParams;
 if(params.getAll('facilityId').length!==1||params.getAll('cursor').length>1)return Response.json({error:{message:'Choose one store.'}},{status:422,headers});
 const input=z.object({facilityId:z.string().cuid(),cursor:z.string().min(1).max(1000).optional()}).strict().parse(Object.fromEntries(params));
 if(await rateLimit(`debicheck-bank-consent-read:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:{message:'Wait a minute before refreshing again.'}},{status:429,headers});
 return Response.json({data:await listStaffBankConsents(scope,input)},{headers});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('FORBIDDEN');const scope=await requirePermissionScope('payments.bank_auth_review');
 const input=z.object({accountId:z.string().cuid(),id:z.string().regex(/^debicheck-bank-consent:[a-f\d-]{36}$/),confirmed:z.literal(true)}).strict().parse(JSON.parse((await boundedBody(new Response(request.body),4096)).toString()));
 if(await rateLimit(`debicheck-bank-consent-review:${scope.organisationId}:${scope.userId}`,10,60000))return Response.json({error:{message:'Wait a minute before reviewing another request.'}},{status:429,headers});
 return Response.json({data:await reviewBankConsent(scope,input)},{headers});
}catch(error){return failure(error)}}
