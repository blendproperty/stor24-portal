import {z} from 'zod';
import {requirePermissionScope} from '@/lib/scope';
import {sameOrigin} from '@/lib/request-security';
import {boundedBody} from '@/lib/payments/netcash-mandate';
import {dlpPrivateHeaders} from '@/lib/dlp-policy';
import {postImportedReceipt,previewImportedReceiptPosting,importedReceiptDocument} from '@/lib/receipt-import-service';
import {protectDlpResponse} from '@/lib/dlp-transfer-service';
export async function GET(request:Request){
 try{
  const scope=await requirePermissionScope('receipt_review.view'),id=z.string().cuid().parse(new URL(request.url).searchParams.get('intakeId'));
  const document=await importedReceiptDocument(scope,id);
  return await protectDlpResponse(new Response(document.content,{headers:{...dlpPrivateHeaders,'content-type':'text/html; charset=utf-8','content-disposition':'inline; filename="stor24-receipt.html"','x-content-type-options':'nosniff','x-document-sha256':document.sha256,'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; base-uri 'none'; form-action 'none'"}}),{organisationId:scope.organisationId,actorId:scope.userId,facilityId:document.facilityId,resourceId:document.documentId},'confidential');
 }catch(error){const code=error instanceof Error?error.message:'';return Response.json({error:'The retained receipt is unavailable in your current access scope or needs finance review.'},{status:code==='UNAUTHENTICATED'?401:['FORBIDDEN','FACILITY_FORBIDDEN'].includes(code)?403:404,headers:dlpPrivateHeaders});}
}
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid request origin.'},{status:403,headers:dlpPrivateHeaders});
 try{
  await requirePermissionScope('receipt_review.post');
  const input=z.discriminatedUnion('action',[
   z.object({action:z.literal('preview'),input:z.unknown()}).strict(),
   z.object({action:z.literal('post'),preview:z.unknown(),requestKey:z.uuid()}).strict(),
  ]).parse(JSON.parse((await boundedBody(new Response(request.body),20000)).toString()));
  const body=z.object({facilityId:z.string().cuid()}).passthrough().parse(input.action==='preview'?input.input:input.preview);
  const scope=await requirePermissionScope('receipt_review.post',body.facilityId);
  return Response.json(input.action==='preview'?{preview:await previewImportedReceiptPosting(scope,input.input)}:await postImportedReceipt(scope,input.preview,input.requestKey),{headers:dlpPrivateHeaders});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:'Check the selected reviewed source and all three finance confirmations.'},{status:422,headers:dlpPrivateHeaders});
  if(['UNAUTHENTICATED','FORBIDDEN','FACILITY_FORBIDDEN'].includes(code))return Response.json({error:'Current receipt-posting, review, payment, ledger and billing access is required for this store.'},{status:code==='UNAUTHENTICATED'?401:403,headers:dlpPrivateHeaders});
  if(/^RECEIPT_|^SETTLEMENT_/.test(code)||error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))return Response.json({error:code==='RECEIPT_REVIEW_INDEPENDENT'?'The person posting must be independent of the evidence capturer and account proposer.':'The source, account or approval needs review. Reload the saved evidence and prepare a fresh preview before posting.'},{status:409,headers:dlpPrivateHeaders});
  return Response.json({error:'Posting outcome could not be confirmed. Reload saved evidence and receipt history before another action; keep the same request reference.'},{status:500,headers:dlpPrivateHeaders});
 }
}
