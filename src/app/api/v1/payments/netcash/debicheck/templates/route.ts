import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin,rateLimit} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {observeDebiCheckTemplate,reviewDebiCheckTemplate,listDebiCheckTemplates} from '@/lib/payments/netcash-debicheck-template-service';
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
function failure(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:{message:'Check the store, template and confirmation.'}},{status:422,headers});
 if(error instanceof Error&&error.message==='MANDATE_RESPONSE_TOO_LARGE')return Response.json({error:{message:'The request is too large.'}},{status:422,headers});
 if(error instanceof Error&&error.message.startsWith('DEBICHECK_'))return Response.json({error:{code:error.message,message:'This template needs source, provider or independent staff review. No bank request or collection was submitted.'}},{status:409,headers});
 return authErrorResponse(error);
}
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('payments.view'),params=new URL(request.url).searchParams;
 if(params.getAll('facilityId').length!==1)return Response.json({error:{message:'Choose one store.'}},{status:422,headers});
 const input=z.object({facilityId:z.string().cuid()}).strict().parse(Object.fromEntries(params));
 if(await rateLimit(`debicheck-template-read:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:{message:'Wait a minute before refreshing again.'}},{status:429,headers});
 return Response.json({data:await listDebiCheckTemplates(scope,input.facilityId)},{headers});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error('FORBIDDEN');const scope=await requirePermissionScope('payments.manage');
 const input=z.discriminatedUnion('action',[z.object({action:z.literal('observe'),facilityId:z.string().cuid(),templateId:z.string().regex(/^NCDCT\d{9}$/)}).strict(),z.object({action:z.literal('review'),id:z.string().regex(/^debicheck-template:[a-f\d-]{36}$/),confirmed:z.literal(true)}).strict()]).parse(JSON.parse((await boundedBody(new Response(request.body),8192)).toString()));
 if(await rateLimit(`debicheck-template-write:${scope.organisationId}:${scope.userId}`,5,60000))return Response.json({error:{message:'Wait a minute before checking another template.'}},{status:429,headers});
 return Response.json({data:input.action==='observe'?await observeDebiCheckTemplate(scope,input):await reviewDebiCheckTemplate(scope,input)},{headers});
}catch(error){return failure(error)}}
