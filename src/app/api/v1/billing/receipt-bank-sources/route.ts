import {confirmedFinanceRollback} from '@/lib/finance/retry-rolled-back-transaction';
import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {sameOrigin,rateLimit} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {protectDlpResponse} from '@/lib/dlp-transfer-service';
import {dlpPrivateHeaders} from '@/lib/dlp-policy';
import {createReceiptBankSource,reviewReceiptBankSource,receiptBankSourceWorkspace,receiptBankSourcePrivateDetails} from '@/lib/receipt-bank-source-service';

function failure(error:unknown){
 const code=error instanceof Error?error.message:'';
 if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:'Check the bank identity, reference and explicit confirmation.'},{status:422,headers:dlpPrivateHeaders});
 if(['UNAUTHENTICATED','FORBIDDEN','FACILITY_FORBIDDEN'].includes(code))return Response.json({error:'This action requires current organisation-wide bank-source and settlement access.'},{status:code==='UNAUTHENTICATED'?401:403,headers:dlpPrivateHeaders});
 if(code==='RECEIPT_BANK_NOT_FOUND')return Response.json({error:'The source is unavailable in your organisation.'},{status:404,headers:dlpPrivateHeaders});
 if(code==='DLP_TRANSFER_BLOCKED')return Response.json({error:'The protected details could not be released.'},{status:403,headers:dlpPrivateHeaders});
 if(code.startsWith('RECEIPT_BANK_')||confirmedFinanceRollback(error)||error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:code==='RECEIPT_BANK_INDEPENDENT'?'Another authorised person must review this bank source.':'The source changed, already exists or needs review. Reload the saved state before continuing.'},{status:409,headers:dlpPrivateHeaders});
 return Response.json({error:'Unable to complete the action. Check the saved state before trying again.'},{status:500,headers:dlpPrivateHeaders});
}
async function scope(){await requirePermissionScope('settlements.view');return requirePermissionScope('receipt_review.bank_sources');}
export async function GET(request:Request){try{const actor=await scope(),cursor=new URL(request.url).searchParams.get('cursor');return Response.json(await receiptBankSourceWorkspace(actor,cursor?z.uuid().parse(cursor):undefined),{headers:dlpPrivateHeaders});}catch(error){return failure(error);}}
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid request origin.'},{status:403,headers:dlpPrivateHeaders});
 try{
  const actor=await scope();
  if(await rateLimit('receipt-bank-source:'+actor.organisationId+':'+actor.userId,30,60000))return Response.json({error:'Wait a minute before another bank-source action.'},{status:429,headers:dlpPrivateHeaders});
  const raw=JSON.parse((await boundedBody(new Response(request.body),10000)).toString());
  const action=z.object({action:z.string()}).passthrough().parse(raw).action;
  if(action==='private-details'){
   const input=z.object({action:z.literal('private-details'),id:z.uuid()}).strict().parse(raw);
   const value=await receiptBankSourcePrivateDetails(actor,input.id);
   return await protectDlpResponse(Response.json(value,{headers:dlpPrivateHeaders}),{organisationId:actor.organisationId,actorId:actor.userId,resourceId:input.id},'restricted');
  }
  if(action==='create'){
   const {action:ignored,...input}=raw;void ignored;
   return Response.json(await createReceiptBankSource(actor,input),{status:201,headers:dlpPrivateHeaders});
  }
  return Response.json(await reviewReceiptBankSource(actor,raw),{headers:dlpPrivateHeaders});
 }catch(error){return failure(error);}
}
