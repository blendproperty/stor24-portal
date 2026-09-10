export type DebitOrderPreferences = { firstCollectionDate: string; collectionDay: number };

export function parseDebitOrderPreferences(value: unknown, earliestDate: string): DebitOrderPreferences | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.firstCollectionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.firstCollectionDate)) return null;
  const date = new Date(input.firstCollectionDate + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.firstCollectionDate || input.firstCollectionDate < earliestDate) return null;
  if (!Number.isInteger(input.collectionDay) || Number(input.collectionDay) < 1 || Number(input.collectionDay) > 31) return null;
  return { firstCollectionDate: input.firstCollectionDate, collectionDay: Number(input.collectionDay) };
}
