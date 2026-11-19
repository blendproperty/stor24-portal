import assert from "node:assert/strict";
import test from "node:test";
import { assertExactFaceAccessLevels } from "../src/lib/hikcentral-customer-access";
import { MIDPOINT_NON_TENANT_DOORS, STOR24_FACE_DOORS } from "../src/lib/integrations/hikcentral-door-scope";

const expected = STOR24_FACE_DOORS;
const narrow = [
  { id: "12", name: "Block24", resourceIds: ["1239", "1244", "1249"] },
  { id: "7", name: "DRIVERS", resourceIds: MIDPOINT_NON_TENANT_DOORS },
];

test("only Block24 and the approved non-tenant Midpoint group can be granted", () => {
  assert.deepEqual(assertExactFaceAccessLevels(narrow, ["12", "7"], expected), narrow);
  assert.throws(() => assertExactFaceAccessLevels([...narrow, { id: "9", name: "Midpoint Access", resourceIds: Array.from({ length: 26 }, (_, i) => String(i)) }], ["12", "9"], expected), /HIKCENTRAL_MIDPOINT_SCOPE_CHANGED/);
  assert.throws(() => assertExactFaceAccessLevels([{ ...narrow[0], resourceIds: [...narrow[0].resourceIds, "control-room"] }, narrow[1]], ["12", "7"], expected), /HIKCENTRAL_BLOCK24_SCOPE_CHANGED/);
  assert.throws(() => assertExactFaceAccessLevels([narrow[0], { ...narrow[1], resourceIds: [...narrow[1].resourceIds, "tenant-turnstile"] }], ["12", "7"], expected), /HIKCENTRAL_MIDPOINT_SCOPE_CHANGED/);
  assert.throws(() => assertExactFaceAccessLevels(narrow, ["12", "missing"], expected), /HIKCENTRAL_ACCESS_LEVEL_MISSING/);
});
