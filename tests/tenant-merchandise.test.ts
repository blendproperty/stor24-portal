import assert from "node:assert/strict";
import test from "node:test";
import { merchandiseRequestSchema, packageItems, priceMerchandise } from "../src/lib/tenant-merchandise";
const product = { id: "one", name: "Tape", sku: "TAPE", sellingPrice: "41.99", quantityOnHand: 10, quantityReserved: 3 };
test("merchandise uses authoritative prices and excludes reserved stock", () => {
  assert.equal(priceMerchandise([{ productId: "one", quantity: 3 }], [product]).total, "125.97");
  assert.throws(() => priceMerchandise([{ productId: "one", quantity: 8 }], [product]), /UNAVAILABLE/);
  assert.throws(() => priceMerchandise([{ productId: "other-store", quantity: 1 }], [product]), /UNAVAILABLE/);
});
test("request input rejects duplicate, negative, fractional and client-priced items", () => {
  const valid = { unit: "account:one", idempotencyKey: "e6c32f4b-bc2c-4dfe-8cd8-14c6fe008abc", items: [{ productId: "one", quantity: 1 }] };
  assert.equal(merchandiseRequestSchema.safeParse(valid).success, true);
  for (const quantity of [-1, 0, 0.5, 101]) assert.equal(merchandiseRequestSchema.safeParse({ ...valid, items: [{ productId: "one", quantity }] }).success, false);
  assert.equal(merchandiseRequestSchema.safeParse({ ...valid, items: [...valid.items, ...valid.items] }).success, false);
  assert.equal(merchandiseRequestSchema.safeParse({ ...valid, total: 1 }).success, false);
});
test("legacy snapshots cannot break the merchandise history", () => {
  assert.deepEqual(packageItems(null), []);
  assert.deepEqual(packageItems([null, {}, { name: "Box", quantity: 2 }, { name: "Bad", quantity: -1 }]), [{ name: "Box", quantity: 2 }]);
});
