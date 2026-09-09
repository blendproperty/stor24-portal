import assert from "node:assert/strict";
import test from "node:test";
import { renderLeaseDocument } from "../src/lib/lease-agreement-content";
import { publicReservationSchema } from "../src/lib/public-booking-contract";
import { productUpdateSchema, storagePackageSchema, storagePackageUpdateSchema } from "../src/lib/validators";

const productId = "cm1234567890123456789012";

test("unit-ready packages require unique facility products and coherent size limits", () => {
  const result = storagePackageSchema.safeParse({
    facilityId: productId,
    code: "MOVE_READY",
    name: "Move Ready",
    description: "A configured collection of storage and moving essentials.",
    sellingPrice: 500,
    minUnitAreaSqM: 9,
    maxUnitAreaSqM: 6,
    items: [{ productId, quantity: 2 }, { productId, quantity: 1 }],
  });
  assert.equal(result.success, false);
});

test("product detail updates cannot directly rewrite physical stock", () => {
  assert.equal(productUpdateSchema.safeParse({ sellingPrice: 49.99, reorderPoint: 5 }).success, true);
  assert.equal(productUpdateSchema.safeParse({ quantityOnHand: 100 }).success, false);
  assert.equal(productUpdateSchema.safeParse({}).success, false);
});

test("package updates support editable quantities, size rules, ordering and channel status", () => {
  const result = storagePackageUpdateSchema.safeParse({
    code: "MOVE_READY",
    name: "Move Ready",
    description: "A revised collection of storage and moving essentials.",
    badge: "Ideal for this size",
    sellingPrice: 2199,
    minUnitAreaSqM: 4,
    maxUnitAreaSqM: 10,
    sortOrder: 30,
    active: false,
    items: [{ productId, quantity: 12 }],
  });
  assert.equal(result.success, true);
});

test("public reservation accepts an optional package identifier", () => {
  const result = publicReservationSchema.safeParse({
    facilitySlug: "midpoint",
    unitId: productId,
    storagePackageId: productId,
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.com",
    phone: "0812345678",
    journey: "RENTAL",
    communicationConsent: {},
    idempotencyKey: "package-test-123456",
  });
  assert.equal(result.success, true);
});

test("the signed agreement snapshot records the selected package and once-off price", () => {
  const content = renderLeaseDocument({
    facilityName: "Midpoint",
    unitNumber: "101",
    customerName: "Test Customer",
    monthlyRate: 1000,
    startDate: new Date("2026-09-10T00:00:00.000Z"),
    paymentMethod: "CARD",
    storagePackage: { name: "Move Ready", priceZar: 500, contents: "10 x box, 2 x tape" },
  });
  assert.match(content, /Optional unit-ready package: Move Ready/);
  assert.match(content, /Package contents: 10 x box, 2 x tape/);
});
