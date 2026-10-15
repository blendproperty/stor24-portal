import { z } from 'zod';
import { requireTenantSession,tenantRateLimit } from '@/lib/tenant-portal-auth';
import { tenantError,tenantPrivateHeaders } from '@/lib/tenant-portal-response';
import { sameOrigin } from '@/lib/request-security';
import { boundedBody } from '@/lib/payments/netcash-mandate';
import { debiCheckPayerSchema } from '@/lib/payments/netcash-debicheck-request-policy';
import { listTenantDebiCheckRequests,previewDebiCheckRequest,saveDebiCheckRequest,withdrawDebiCheckRequest } from '@/lib/payments/netcash-debicheck-request-service';

const id=z.string().min(1).max(120),recordId=z.string().regex(/^debicheck-request:[a-f\d-]{36}$/);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),accountId:id,templateObservationId:z.string().regex(/^debicheck-template:[a-f\d-]{36}$/),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),payer:debiCheckPayerSchema}).strict(),
 z.object({action:z.literal('save'),accountId:id,preview:z.record(z.string(),z.unknown()),accepted:z.literal(true)}).strict(),
 z.object({action:z.literal('withdraw'),accountId:id,id:recordId}).strict(),
]);
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof Error&&['MANDATE_RESPONSE_TOO_LARGE','MANDATE_RESPONSE_INVALID'].includes(error.message)))return Response.json({error:'Check the request details and confirmation.'},{status:422,headers:tenantPrivateHeaders});
 if(error instanceof Error&&/^(DEBICHECK|CARD_AUTOPAY|BILLING|RENT_REVIEW)_/.test(error.message))return Response.json({error:'This setup needs a fresh preview or staff review. No bank request or collection has been submitted.',code:error.message},{status:409,headers:tenantPrivateHeaders});
 if(error&&typeof error==='object'&&'code' in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:'Another request changed this account. Refresh its saved status before continuing.'},{status:409,headers:tenantPrivateHeaders});
 return tenantError(error);
}
export async function GET(request:Request){try{
 const session=await requireTenantSession(),params=new URL(request.url).searchParams;
 if(params.getAll('accountId').length!==1||[...params.keys()].some(key=>key!=='accountId'))return Response.json({error:'Choose one account.'},{status:422,headers:tenantPrivateHeaders});
 const accountId=id.parse(params.get('accountId'));
 if(await tenantRateLimit(`tenant:debicheck-read:${session.tokenHash}`,30,60000))return Response.json({error:'Wait a minute before refreshing again.'},{status:429,headers:tenantPrivateHeaders});
 return Response.json({data:await listTenantDebiCheckRequests(session,accountId)},{headers:tenantPrivateHeaders});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('TENANT_NOT_FOUND');
 const session=await requireTenantSession();
 if(await tenantRateLimit(`tenant:debicheck-write:${session.tokenHash}`,10,60000))return Response.json({error:'Wait a minute before continuing.'},{status:429,headers:tenantPrivateHeaders});
 const value=input.parse(JSON.parse((await boundedBody(new Response(request.body),16384)).toString()));
 const data=value.action==='preview'?await previewDebiCheckRequest(session,value):value.action==='save'?await saveDebiCheckRequest(session,value):await withdrawDebiCheckRequest(session,value.accountId,value.id);
 return Response.json({data},{headers:tenantPrivateHeaders});
}catch(error){return failure(error)}}
