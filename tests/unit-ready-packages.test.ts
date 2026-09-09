import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.equal(productUpdateSchema.safeParse({ imageUrl: "data:image/webp;base64,YWJj" }).success, true);
  assert.equal(productUpdateSchema.safeParse({ imageUrl: "javascript:alert(1)" }).success, false);
  assert.equal(productUpdateSchema.safeParse({ quantityOnHand: 100 }).success, false);
  assert.equal(productUpdateSchema.safeParse({}).success, false);
});

test("merchandise editors retain readable responsive form controls", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.merch-fields \.form-grid\.two[^}]*display:\s*grid/);
  assert.match(css, /\.merch-fields \.form-grid\.two input[^}]*min-height:\s*46px/);
  assert.match(css, /@media \(max-width:\s*720px\)[^{]*\{[^}]*\.merch-fields \.form-grid\.two[^}]*grid-template-columns:\s*1fr/);
});

test("package updates support editable quantities, size rules, ordering and channel status", () => {
  const result = storagePackageUpdateSchema.safeParse({
    code: "MOVE_READY",
    name: "Move Ready",
    description: "A revised collection of storage and moving essentials.",
    badge: "Ideal for this size",
    imageUrl: "https://images.example.com/move-ready.webp",
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

test("public reservation accepts a custom priced merchandise bundle", () => {
  const base = {
    facilitySlug: "midpoint", unitId: productId, firstName: "Test", lastName: "Customer",
    email: "test@example.com", phone: "0812345678", journey: "RENTAL" as const,
    communicationConsent: {}, idempotencyKey: "custom-package-123456",
  };
  assert.equal(publicReservationSchema.safeParse({ ...base, customPackageItems: [{ productId, quantity: 3 }] }).success, true);
  assert.equal(publicReservationSchema.safeParse({ ...base, storagePackageId: productId, customPackageItems: [{ productId, quantity: 3 }] }).success, false);
  assert.equal(publicReservationSchema.safeParse({ ...base, customPackageItems: [{ productId, quantity: 0 }] }).success, false);
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
