import {z} from "zod";
import {requirePermissionScope} from "@/lib/scope";
import {authErrorResponse} from "@/lib/auth-guards";
import {sameOrigin,rateLimit} from "@/lib/request-security";
import {boundedBody} from "@/lib/payments/netcash-mandate";
import {refreshNetcashPaymentEvidence} from "@/lib/payments/netcash-payment-evidence";
const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff"};
export async function POST(request:Request){try{if(!sameOrigin(request))throw Error("FORBIDDEN");const scope=await requirePermissionScope("payments.view");const input=z.object({paymentId:z.string().cuid()}).strict().parse(JSON.parse((await boundedBody(new Response(request.body),2048)).toString()));if(await rateLimit(`netcash-evidence:${scope.organisationId}:${scope.userId}`,20,60000))return Response.json({error:{message:"Wait a minute before checking more provider outcomes."}},{status:429,headers});return Response.json({data:await refreshNetcashPaymentEvidence(scope,input.paymentId)},{headers})}catch(e){if(e&&typeof e==="object"&&"code"in e&&["P2002","P2034"].includes(String(e.code)))return Response.json({error:{message:"Another verification changed this record. Reload before checking again."}},{status:409,headers});if(e instanceof Error&&/^NETCASH_/.test(e.message))return Response.json({error:{code:e.message.split(":")[0],message:"The provider outcome or original merchant/source needs review. No financial records changed."}},{status:409,headers});return authErrorResponse(e)}}
