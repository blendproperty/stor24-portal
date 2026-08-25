import assert from "node:assert/strict";
import test from "node:test";
import { unitTypeLabel, unitTypeSize } from "../src/lib/unit-type-label";

test("unit type labels include dimensions and area", () => {
  assert.equal(unitTypeLabel({ name: "B2", widthMetres: "3.00", lengthMetres: "2.00", areaSqMetres: "6.00" }), "B2 · 3 m × 2 m · 6 m²");
});

test("unit type size calculates area when only dimensions are stored", () => {
  assert.equal(unitTypeSize({ name: "A", widthMetres: 1.5, lengthMetres: 2 }), "1,5 m × 2 m · 3 m²");
});

test("unit type size clearly identifies missing source data", () => {
  assert.equal(unitTypeSize({ name: "FF-E10" }), "Size not recorded");
});
