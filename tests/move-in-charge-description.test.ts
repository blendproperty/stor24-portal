import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPLETED_MOVE_IN_CHARGE_DESCRIPTION,
  PENDING_MOVE_IN_CHARGE_DESCRIPTION,
} from "../src/lib/leasing-service.ts";

test("move-in charge wording distinguishes pending from completed leases", () => {
  assert.equal(PENDING_MOVE_IN_CHARGE_DESCRIPTION, "Move-in charge (pending lease signature)");
  assert.equal(COMPLETED_MOVE_IN_CHARGE_DESCRIPTION, "Move-in charge");
  assert.notEqual(PENDING_MOVE_IN_CHARGE_DESCRIPTION, COMPLETED_MOVE_IN_CHARGE_DESCRIPTION);
});

test("both lease activation paths complete the pending move-in charge", () => {
  const service = readFileSync(new URL("../src/lib/leasing-service.ts", import.meta.url), "utf8");
  const activationUpdates = service.match(/await completeMoveInCharge\(tx, [^)]+\);/g) ?? [];

  assert.equal(activationUpdates.length, 2);
});
