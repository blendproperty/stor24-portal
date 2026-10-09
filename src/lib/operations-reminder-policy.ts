export function reorderItemCount(products: { quantityOnHand: number; quantityReserved: number; reorderPoint: number }[]) {
  return products.filter(p => p.quantityOnHand - p.quantityReserved <= p.reorderPoint).length;
}

export function collectionCallCount(rows: { ageing: { issue: string | null; overdue: number }; hold: string | null; nextFollowUp: string | null }[], today: string) {
  return rows.filter(row => !row.ageing.issue && !row.hold && row.ageing.overdue > 0 && !!row.nextFollowUp && row.nextFollowUp <= today).length;
}
