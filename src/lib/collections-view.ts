import { buckets, csvCell } from "@/lib/collections-policy";
import type { CollectionsWorkspaceData } from "@/lib/collections-service";
export type CollectionFilters = { search: string; facility: string; mode: string; owner: string };
export function filterCollections(data: CollectionsWorkspaceData, filters: CollectionFilters) {
  return data.rows.filter(r => (!filters.facility || r.facilityId === filters.facility) && (!filters.owner || (filters.owner === "unassigned" ? !r.ownerId : r.ownerId === filters.owner)) && `${r.accountNumber} ${r.name}`.toLowerCase().includes(filters.search.toLowerCase()) && (
    filters.mode === "all" || (filters.mode === "review" ? !!r.ageing.issue : filters.mode === "disputes" ? r.disputed : filters.mode === "promises" ? r.promises.some(p => p.status === "OPEN") : filters.mode === "follow-up" ? !!r.nextFollowUp && r.nextFollowUp <= data.today && !r.ageing.issue && !r.hold && r.ageing.overdue > 0 : filters.mode.startsWith("bucket-") ? !r.ageing.issue && r.ageing.buckets[Number(filters.mode.slice(7))] > 0 : !r.ageing.issue && r.ageing.overdue > 0)
  )).sort((a, b) => b.ageing.oldestDays - a.ageing.oldestDays || b.ageing.overdue - a.ageing.overdue || a.accountNumber.localeCompare(b.accountNumber));
}
export function collectionCsv(data: CollectionsWorkspaceData, filters: CollectionFilters) {
  const rows = filterCollections(data, filters);
  return "\uFEFF" + [["As of (SAST)", "Account", "Tenant", "Store", "Current recorded balance", ...buckets, "Overdue", "Credit", "Review reason", "Current hold", "Current owner", "Current next follow-up", "Ageing basis"], ...rows.map(r => [data.asOf, r.accountNumber, r.name, r.facility, r.currentBalance, ...r.ageing.buckets.map(n => r.ageing.issue ? "" : (n / 100).toFixed(2)), r.ageing.issue ? "" : (r.ageing.overdue / 100).toFixed(2), r.ageing.issue ? "" : (r.ageing.credit / 100).toFixed(2), r.ageing.issue, r.hold, r.owners.find(o => o.id === r.ownerId)?.name ?? (r.ownerId ? "Owner requires review" : "Unassigned"), r.nextFollowUp, r.terms ? `Approved ${r.terms.dueDays} days; oldest due first; ${r.terms.approvalReference}` : "No approved terms"])] .map(row => row.map(csvCell).join(",")).join("\r\n");
}
