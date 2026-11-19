import assert from "node:assert/strict";
import test from "node:test";
import { assertExactFaceAccessLevels } from "../src/lib/hikcentral-customer-access";

const expected = ["1239", "1244", "1249", "701", "702"];
const narrow = [
  { id: "12", name: "Block24", resourceIds: ["1239", "1244", "1249"] },
  { id: "77", name: "STOR24 visitor faces", resourceIds: ["701", "702"] },
];

test("only the three Block24 doors plus two visitor face readers can be granted", () => {
  assert.deepEqual(assertExactFaceAccessLevels(narrow, ["12", "77"], expected), narrow);
  assert.throws(() => assertExactFaceAccessLevels([...narrow, { id: "26", name: "Midpoint Access", resourceIds: Array.from({ length: 26 }, (_, i) => String(i)) }], ["12", "26"], expected), /HIKCENTRAL_ACCESS_SCOPE_MISMATCH/);
  assert.throws(() => assertExactFaceAccessLevels([{ ...narrow[0], resourceIds: [...narrow[0].resourceIds, "control-room"] }, narrow[1]], ["12", "77"], expected), /HIKCENTRAL_BLOCK24_SCOPE_CHANGED/);
  assert.throws(() => assertExactFaceAccessLevels(narrow, ["12", "missing"], expected), /HIKCENTRAL_ACCESS_LEVEL_MISSING/);
});
