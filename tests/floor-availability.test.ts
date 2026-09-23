import assert from "node:assert/strict";
import test from "node:test";
import { facilityFloorKeys, floorIsOperational, floorKey, unitIsOperational } from "../src/lib/floor-availability";

test("numeric and named floors share an operational policy; ground stays independent", () => {
  for (const name of ["1", "1st floor", "First Floor", " floor 1 ", "Level 1"]) {
    assert.equal(floorKey(name), "first floor");
    assert.equal(floorIsOperational(name, ["first floor", "second floor"]), false);
  }
  assert.equal(floorIsOperational("Ground Floor", ["First Floor", "Second Floor"]), true);
  assert.equal(floorIsOperational("2nd Floor", ["second floor"]), false);
  assert.equal(floorIsOperational("Basement", []), true);
});
test("a closed map blocks an unlabelled or inconsistently labelled unit", () => {
  assert.equal(unitIsOperational({ floor: null, mapElements: [{ map: { name: "First Floor" } }] }, ["first floor"]), false);
  assert.equal(unitIsOperational({ floor: "Ground Floor", mapElements: [{ map: { name: "Second Floor" } }] }, ["second floor"]), false);
});
test("floor choices keep closed empty floors and deduplicate aliases", () => {
  assert.deepEqual(facilityFloorKeys({ closedFloors: ["Second Floor"], units: [{ floor: "1" }, { floor: " First Floor " }, { floor: null }], maps: [{ name: "Ground Floor" }] }), ["ground floor", "first floor", "second floor"]);
});
