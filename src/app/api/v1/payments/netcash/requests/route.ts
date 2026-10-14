import {z} from "zod";
import {requireFacility,requirePermissionScope,type RequestScope} from "@/lib/scope";
import {authErrorResponse} from "@/lib/auth-guards";
import {sameOrigin,rateLimit} from "@/lib/request-security";
import {boundedBody} from "@/lib/payments/netcash-mandate";
import {previewAccountPaymentRequest,createAccountPaymentRequest,listAccountPaymentRequests} from "@/lib/payments/netcash-payment-request-service";
const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff"};
async function scopes(write:boolean){const payment=await requirePermissionScope(write?"payments.manage":"payments.view"),ledger=await requirePermissionScope("ledger.view");return{payment,ledger};}
async function requireAccountLedger(scope:RequestScope,accountId:string){
 const{db}=await import("@/lib/db");const account=await db.account.findFirst({where:{id:accountId,customer:{organisationId:scope.organisationId}},select:{tenancy:{select:{facilityId:true}}}});
 if(!account?.tenancy)throw Error("PAYMENT_REQUEST_ACCOUNT_NOT_FOUND");await requireFacility(scope,account.tenancy.facilityId);
}
function failure(error:unknown){
 if(error instanceof Error&&error.message==="MANDATE_RESPONSE_TOO_LARGE")return Response.json({error:{message:"The submitted review is too large."}},{status:422,headers});
 if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:{message:"Check the account, amount and confirmation. Reload stale reviews."}},{status:422,headers});
 if(error instanceof Error&&/^(PAYMENT_REQUEST|PAYNOW)_/.test(error.message))return Response.json({error:{code:error.message,message:"The source or provider request needs review. No new account charge was posted; do not repeat an uncertain attempt."}},{status:409,headers});
 if(error&&typeof error==="object"&&"code"in error&&["P2002","P2034"].includes(String(error.code)))return Response.json({error:{message:"Another request changed this account. Reload before continuing."}},{status:409,headers});
 return authErrorResponse(error);
}
export async function GET(request:Request){try{
 const{payment,ledger}=await scopes(false);const input=z.object({accountId:z.string().cuid()}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));await requireAccountLedger(ledger,input.accountId);
 if(await rateLimit(`payment-request-read:${payment.organisationId}:${payment.userId}`,30,60000))return Response.json({error:{message:"Wait a minute before refreshing again."}},{status:429,headers});
 return Response.json({data:await listAccountPaymentRequests(payment,input.accountId)},{headers});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw Error("FORBIDDEN");const{payment,ledger}=await scopes(true);
 const input=z.discriminatedUnion("action",[z.object({action:z.literal("preview"),accountId:z.string().cuid(),amount:z.string().regex(/^\d{1,6}\.\d{2}$/).optional()}).strict(),z.object({action:z.literal("create"),preview:z.record(z.string(),z.unknown()),confirmed:z.literal(true)}).strict()]).parse(JSON.parse((await boundedBody(new Response(request.body),8192)).toString()));
 if(await rateLimit(`payment-request-write:${payment.organisationId}:${payment.userId}`,10,60000))return Response.json({error:{message:"Wait a minute before preparing another request."}},{status:429,headers});
 if(input.action==="preview"){await requireAccountLedger(ledger,input.accountId);return Response.json({data:await previewAccountPaymentRequest(payment,input.accountId,input.amount)},{headers});}
 const accountId=z.string().cuid().parse(input.preview.accountId);await requireAccountLedger(ledger,accountId);return Response.json({data:await createAccountPaymentRequest(payment,input)},{headers});
}catch(error){return failure(error)}}
