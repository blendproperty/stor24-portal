import type { RequestScope } from "@/lib/scope";
import { approveScheduledInvoiceDraft, readScheduledInvoiceDraft } from "@/lib/monthly-billing-service";
export type BatchItem = { accountId: string; period: string; fingerprint: string };
const code = (error: unknown) => error instanceof Error && /^BILLING_[A-Z_]+$/.test(error.message) ? error.message : "BILLING_REVIEW_REQUIRED";
export async function reviewInvoiceDraftBatch(scope: RequestScope, accountIds: string[]) {
  const results=[];
  for (const accountId of accountIds) {
    try { const draft=await readScheduledInvoiceDraft(scope,accountId); results.push(draft ? { accountId, draft, error:null } : { accountId, draft:null, error:"BILLING_NO_DRAFT" }); }
    catch(error) { results.push({ accountId, draft:null, error:code(error) }); }
  }
  return results;
}
export async function approveInvoiceDraftBatch(scope: RequestScope, items: BatchItem[]) {
  const results=[];
  // Each account is independently locked and posted; report every outcome explicitly.
  for (const item of items) {
    try { const posted=await approveScheduledInvoiceDraft(scope,item.accountId,item.period,item.fingerprint); results.push({accountId:item.accountId,posted,error:null}); }
    catch(error) { results.push({accountId:item.accountId,posted:null,error:code(error)}); }
  }
  return results;
}
