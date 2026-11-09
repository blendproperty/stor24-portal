import { z } from "zod";
import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { sendSavedInvoice, savedInvoiceDeliveryStatus } from "@/lib/finance/saved-invoice-delivery";
export async function POST(request: Request, context: {params: Promise<{id:string}>}) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const {id} = await context.params; z.string().cuid().parse(id);
    const input=z.object({requestId:z.uuid(),email:z.email(),confirm:z.literal(true),allowNotice:z.boolean()}).strict().parse(await request.json());
    const scope=await requirePermissionScope("billing.documents.send");
    return Response.json({data:await sendSavedInvoice(scope,id,input.requestId,input.email,input.allowNotice)},{headers:{"cache-control":"private, no-store"}});
  } catch(error) {
    if(error instanceof Error && error.message.startsWith("INVOICE_")) return Response.json({error:{code:error.message,message:"Review the invoice, customer email and any unconfirmed delivery before trying again."}},{status:409});
    return authErrorResponse(error);
  }
}

export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  try {
    const {id}=await context.params; z.string().cuid().parse(id);
    const scope=await requirePermissionScope("billing.documents.send");
    return Response.json({data:await savedInvoiceDeliveryStatus(scope,id)},{headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
  } catch(error) { return authErrorResponse(error); }
}
