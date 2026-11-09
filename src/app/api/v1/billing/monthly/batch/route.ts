import { z } from "zod";
import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { billingPeriodSchema } from "@/lib/monthly-billing-policy";
import { approveInvoiceDraftBatch, reviewInvoiceDraftBatch, inspectInvoiceBatchOutcome } from "@/lib/invoice-draft-batch";
const item=z.object({accountId:z.string().cuid(),period:billingPeriodSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const unique=(ids:string[])=>new Set(ids).size===ids.length;
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("review"),accountIds:z.array(z.string().cuid()).min(1).max(50).refine(unique)}).strict(),
 z.object({action:z.literal("status"),accountIds:z.array(z.string().cuid()).min(1).max(50).refine(unique),period:billingPeriodSchema}).strict(),
 z.object({action:z.literal("approve"),items:z.array(item).min(1).max(50).refine(items=>unique(items.map(item=>item.accountId))),confirm:z.literal(true)}).strict(),
]);
export async function POST(request:Request) {
 try {
  if (!sameOrigin(request)) throw new Error("FORBIDDEN");
  const input=schema.parse(await request.json()),scope=await requirePermissionScope(input.action === "approve" ? "billing.manage" : "billing.view");
  const data=input.action === "review" ? await reviewInvoiceDraftBatch(scope,input.accountIds) : input.action === "status" ? await inspectInvoiceBatchOutcome(scope,input.accountIds,input.period) : await approveInvoiceDraftBatch(scope,input.items);
  return Response.json({data},{headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
 } catch(error){return authErrorResponse(error);}
}
