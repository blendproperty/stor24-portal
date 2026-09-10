/** Read-only statement arithmetic. Amounts in the ledger are positive magnitudes. */
export type StatementEntry = { id: string; type: string; amount: string; description: string; effectiveAt: Date; reversalOfId?: string | null };

export function statementAccountScope(id: string, organisationId: string, allowedFacilityIds: string[] | null) {
  return { id, customer: { organisationId }, ...(allowedFacilityIds ? { tenancy: { facilityId: { in: allowedFacilityIds } } } : {}) };
}

export function statementPeriod(from: string, to: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_PERIOD");
    const date = new Date(`${value}T00:00:00+02:00`);
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7200000).toISOString().slice(0, 10) !== value) throw new Error("INVALID_PERIOD");
    return date;
  };
  const start = parse(from), end = parse(to);
  if (start > end) throw new Error("INVALID_PERIOD");
  return { start, endExclusive: new Date(end.getTime() + 86400000) };
}

export function buildAccountStatement(entries: StatementEntry[], start: Date, endExclusive: Date) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const signed = (entry: StatementEntry, seen = new Set<string>()): number => {
    if (seen.has(entry.id)) throw new Error("INVALID_REVERSAL");
    seen.add(entry.id);
    const cents = Math.round(Number(entry.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("INVALID_AMOUNT");
    if (entry.type === "REVERSAL") {
      const original = entry.reversalOfId ? byId.get(entry.reversalOfId) : undefined;
      if (!original) throw new Error("INVALID_REVERSAL");
      return signed(original, seen) >= 0 ? -cents : cents;
    }
    if (["CHARGE", "REFUND"].includes(entry.type)) return cents;
    if (["PAYMENT", "CREDIT", "WRITE_OFF"].includes(entry.type)) return -cents;
    throw new Error("INVALID_ENTRY_TYPE");
  };
  let opening = 0, running = 0;
  const rows: { id: string; date: string; description: string; type: string; debit: string; credit: string; balance: string }[] = [];
  for (const entry of entries) {
    if (entry.effectiveAt >= endExclusive) continue;
    const amount = signed(entry);
    running += amount;
    if (!Number.isSafeInteger(running)) throw new Error("INVALID_AMOUNT");
    if (entry.effectiveAt < start) opening += amount;
    else rows.push({ id: entry.id, date: entry.effectiveAt.toISOString(), description: entry.description, type: entry.type, debit: amount > 0 ? (amount / 100).toFixed(2) : "0.00", credit: amount < 0 ? (-amount / 100).toFixed(2) : "0.00", balance: (running / 100).toFixed(2) });
  }
  return { openingBalance: (opening / 100).toFixed(2), closingBalance: (running / 100).toFixed(2), rows };
}
