import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { collectionsWorkspace } from "@/lib/collections-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { previewCollectionNoticeBatch, prepareCollectionNoticeBatch, approveCollectionNoticeBatch } from "@/lib/collection-notice-service";
import { noticeBatchAccountsSchema, noticeBatchPreparationSchema, noticeBatchApprovalSchema } from "@/lib/collection-notice-batch-policy";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), accounts: noticeBatchAccountsSchema }).strict(),
  noticeBatchPreparationSchema.extend({ action: z.literal("prepare") }),
  noticeBatchApprovalSchema.extend({ action: z.literal("approve") }),
]);
export async function GET() {
  try {
    const scope = await requirePermissionScope("collections.manage");
    const data = await collectionsWorkspace(scope, southAfricaDateKey(new Date()));
    return Response.json({ rows: data.rows.map(({id,accountNumber,name,facility,facilityId})=>({id,accountNumber,name,facility,facilityId})) }, { headers });
  } catch(error) {
    const code=error instanceof Error?error.message:"";
    const status=code==="UNAUTHENTICATED"?401:code==="FORBIDDEN"?403:code==="COLLECTION_LIMIT"?409:500;
    return Response.json({error:status===401?"Sign in is required.":status===403?"Collection-management permission is required.":status===409?"More than 2,000 accounts are in scope. Use a narrower permitted store role.":"Unable to load permitted collection accounts."},{status,headers});
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("collections.manage");
    const input = commandSchema.parse(JSON.parse((await boundedBody(new Response(request.body), 16000)).toString()));
    if (await rateLimit(`collection-notice-bulk:${scope.organisationId}:${scope.userId}`, 10, 60000)) return Response.json({ error: "Wait a minute before preparing another audience." }, { status: 429, headers });
    if(input.action==="preview"){
      const result=await previewCollectionNoticeBatch(scope,input.accounts);
      const items=await Promise.all(result.items.map(async item=>{
        let canSend=false;
        try{await requirePermissionScope("billing.documents.send",item.source.facilityId);canSend=true}catch{/* Sending is a separate per-store grant. */}
        return{...item,canSend};
      }));
      return Response.json({...result,items},{headers});
    }
    const result=input.action === "prepare" ? await prepareCollectionNoticeBatch(scope, { items: input.items, confirm: input.confirm }) : await approveCollectionNoticeBatch(scope,{items:input.items,reference:input.reference,confirm:input.confirm});
    return Response.json(result,{headers});
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const conflict = ["COLLECTION_NOTICE_CHANGED", "COLLECTION_NOTICE_HOLD", "COLLECTION_NOTICE_IMMUTABLE", "COLLECTION_NOTICE_INTEGRITY", "COLLECTION_NOTICE_SELF_APPROVAL"].includes(code) || !!(error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code)));
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError || ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(code);
    const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "COLLECTION_NOT_FOUND", "COLLECTION_NOTICE_NOT_FOUND"].includes(code) ? 403 : invalid ? 400 : conflict ? 409 : 500;
    return Response.json({ error: status === 401 ? "Sign in is required." : status === 403 ? "This audience is outside your collection-management scope." : status === 400 ? "Select 1 to 20 different accounts and confirm the reviewed messages." : code === "COLLECTION_NOTICE_SELF_APPROVAL" ? "A different authorised colleague must approve every draft. No notices were approved." : conflict ? "An account, consent, message or notice changed or is held. This failed group action changed no notices. Preview the audience again." : "Unable to update this audience. Reload the saved notices before retrying." }, { status, headers });
  }
}
