import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import { prepareUnitRateAdjustment, unitRateAdjustmentSchema } from "../src/lib/unit-rate-adjustment";

const input = { facilityId: "store", areaSqMetres: "9", direction: "INCREASE" as const, mode: "RAND" as const, value: "50" };
const unit = (id: string, rate: string) => ({ id, number: id, floor: "Ground", status: "AVAILABLE", monthlyRate: new Prisma.Decimal(rate),
  taxRate: new Prisma.Decimal("0.15"), updatedAt: new Date("2026-10-23T08:00:00Z"), unitType: { name: "Small" } });

test("rand and percentage increases/reductions preserve different base rates and round half up", () => {
  const rows = [unit("a", "100.00"), unit("b", "199.99")];
  assert.deepEqual(prepareUnitRateAdjustment(input, rows).changes.map(row => row.newRate), ["150.00", "249.99"]);
  assert.deepEqual(prepareUnitRateAdjustment({ ...input, direction: "REDUCE" }, rows).changes.map(row => row.newRate), ["50.00", "149.99"]);
  const percent = { ...input, mode: "PERCENT" as const, value: "5" };
  assert.equal(prepareUnitRateAdjustment(percent, [unit("a", "0.10")]).changes[0].newRate, "0.11");
  assert.equal(prepareUnitRateAdjustment({ ...percent, direction: "REDUCE" }, rows).newTotal, "284.99");
  assert.equal(rows[0].monthlyRate.toFixed(2), "100.00");
});

test("invalid inputs, empty selection, zero/negative/overflow prices and rounded no-ops are rejected", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "1e3", "1.001", " 10", "100000000"]) assert.equal(unitRateAdjustmentSchema.safeParse({ ...input, value }).success, false, value);
  assert.throws(() => prepareUnitRateAdjustment(input, []), /EMPTY/);
  for (const value of ["100", "101"]) assert.throws(() => prepareUnitRateAdjustment({ ...input, direction: "REDUCE", value }, [unit("a", "100")]), /INVALID_RATE/);
  assert.throws(() => prepareUnitRateAdjustment(input, [unit("a", "9999999999.99")]), /INVALID_RATE/);
  assert.throws(() => prepareUnitRateAdjustment({ ...input, mode: "PERCENT", value: "0.01" }, [unit("a", "1")]), /NO_CHANGE/);
});

test("fingerprint is stable for read ordering and changes with scope, adjustment, price, membership or revision", () => {
  const rows = [unit("a", "100"), unit("b", "200")];
  const hash = prepareUnitRateAdjustment(input, rows).previewHash;
  assert.equal(prepareUnitRateAdjustment(input, [...rows].reverse()).previewHash, hash);
  for (const change of [{ facilityId: "other" }, { areaSqMetres: "12" }, { value: "51" }]) assert.notEqual(prepareUnitRateAdjustment({ ...input, ...change }, rows).previewHash, hash);
  assert.notEqual(prepareUnitRateAdjustment(input, [rows[0]]).previewHash, hash);
  assert.notEqual(prepareUnitRateAdjustment(input, [unit("a", "101"), rows[1]]).previewHash, hash);
  assert.notEqual(prepareUnitRateAdjustment(input, [{ ...rows[0], updatedAt: new Date() }, rows[1]]).previewHash, hash);
});
