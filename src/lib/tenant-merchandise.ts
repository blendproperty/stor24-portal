import { z } from "zod";
export const merchandiseRequestSchema = z.object({
  unit: z.string().regex(/^(account|reservation):[a-zA-Z0-9_-]+$/).max(200),
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50),
}).strict().refine(value => new Set(value.items.map(item => item.productId)).size === value.items.length, "Duplicate products");
export function priceMerchandise(items: { productId: string; quantity: number }[], products: { id: string; name: string; sku: string; sellingPrice: { toString(): string }; quantityOnHand: number; quantityReserved: number }[]) {
  const snapshot = items.map(item => {
    const product = products.find(product => product.id === item.productId);
    if (!product || item.quantity > Math.max(0, product.quantityOnHand - product.quantityReserved)) throw new Error("MERCHANDISE_UNAVAILABLE");
    const cents = Math.round(Number(product.sellingPrice.toString()) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("MERCHANDISE_UNAVAILABLE");
    return { productId: product.id, name: product.name, sku: product.sku, quantity: item.quantity, unitPriceZar: (cents / 100).toFixed(2), lineTotalZar: (cents * item.quantity / 100).toFixed(2) };
  });
  const totalCents = snapshot.reduce((sum, item) => sum + Math.round(Number(item.lineTotalZar) * 100), 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > 100000000) throw new Error("MERCHANDISE_UNAVAILABLE");
  return { items: snapshot, total: (totalCents / 100).toFixed(2) };
}
export function packageItems(value: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { name: string; quantity: number } => !!item && typeof item === "object" && typeof item.name === "string" && Number.isInteger(item.quantity) && item.quantity > 0);
}
