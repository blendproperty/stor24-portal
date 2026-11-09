import type { RequestScope } from "@/lib/scope";
import { approveScheduledInvoiceDraft, readScheduledInvoiceDraft } from "@/lib/monthly-billing-service";
import { readScheduledCombined, postCombinedBilling } from "@/lib/combined-billing-preview";
export type BatchItem = { accountId: string; period: string; fingerprint: string };
const code = (error: unknown) => error instanceof Error && /^(BILLING|COMBINED)_[A-Z_]+$/.test(error.message) ? error.message : "BILLING_REVIEW_REQUIRED";
export async function reviewInvoiceDraftBatch(scope: RequestScope, accountIds: string[]) {
  const results=[]; const seen=new Set<string>();
  for (const accountId of accountIds) {
    try {
      const combined=await readScheduledCombined(scope,accountId);
      if (combined) {
        const key=`${combined.customerId}:${combined.facilityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lines=combined.accounts.flatMap(b=>b.lines.map(line=>({...line,key:`${b.accountId}:${line.key}`,description:`${b.accountNumber} - ${line.description}`})));
        results.push({accountId,draft:{...combined,customerName:combined.accounts[0].customerName,accountNumber:combined.accounts.map(b=>b.accountNumber).join(", "),lines,taxTotal:combined.accounts.reduce((sum,b)=>sum+b.taxTotal,0),combined:true},error:null});
      } else {
        const draft=await readScheduledInvoiceDraft(scope,accountId);
        results.push(draft ? {accountId,draft,error:null} : {accountId,draft:null,error:"BILLING_NO_DRAFT"});
      }
    } catch(error) { results.push({accountId,draft:null,error:code(error)}); }
  }
  return results;
}
export async function approveInvoiceDraftBatch(scope: RequestScope, items: BatchItem[]) {
  const results=[]; const seen=new Set<string>();
  for (const item of items) {
    try {
      const combined=await readScheduledCombined(scope,item.accountId);
      if (combined) {
        const key=`${combined.customerId}:${combined.facilityId}`;
        if (seen.has(key)) { results.push({accountId:item.accountId,posted:null,error:"BILLING_DRAFT_EXISTS"}); continue; }
        seen.add(key);
        if (combined.period !== item.period || combined.fingerprint !== item.fingerprint) throw new Error("BILLING_PREVIEW_CHANGED");
        const posted=await postCombinedBilling(scope,{customerId:combined.customerId,facilityId:combined.facilityId,period:item.period},item.fingerprint,true);
        results.push({accountId:item.accountId,posted,error:null});
      } else {
        const posted=await approveScheduledInvoiceDraft(scope,item.accountId,item.period,item.fingerprint);
        results.push({accountId:item.accountId,posted,error:null});
      }
    } catch(error) { results.push({accountId:item.accountId,posted:null,error:code(error)}); }
  }
  return results;
}
