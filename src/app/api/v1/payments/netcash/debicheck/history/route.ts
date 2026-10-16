import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {authErrorResponse} from '@/lib/auth-guards';
import {rateLimit} from '@/lib/request-security';
import {debiCheckHistoryQuery} from '@/lib/payments/netcash-debicheck-history-policy';
import {readDebiCheckHistory} from '@/lib/payments/netcash-debicheck-history-service';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('payments.view'),params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))throw Error('DEBICHECK_HISTORY_QUERY');
 const query=debiCheckHistoryQuery.parse(Object.fromEntries(params));
 if(await rateLimit(`debicheck-history:${scope.organisationId}:${scope.userId}`,30,60000))return Response.json({error:{message:'Wait a minute before refreshing history.'}},{status:429,headers});
 return Response.json({data:await readDebiCheckHistory(scope,query)},{headers});
}catch(error){
 if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof Error&&error.message==='DEBICHECK_HISTORY_QUERY')return Response.json({error:{message:'Choose one permitted store and valid history filters.'}},{status:422,headers});
 if(error instanceof Error&&error.message==='DEBICHECK_HISTORY_NOT_FOUND')return Response.json({error:{message:'The selected retained attempt is unavailable at this store.'}},{status:404,headers});
 if(error instanceof Error&&error.message.startsWith('DEBICHECK_'))return Response.json({error:{message:'Retained authentication evidence needs review. No provider request was made. Refresh or ask an authorised colleague to investigate.'}},{status:409,headers});
 const response=authErrorResponse(error);for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}}
