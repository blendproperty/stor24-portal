import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { reservationLifecycleSchema } from "../src/lib/validators";

test("reservation lifecycle actions require a reason and valid extension date", () => {
  assert.equal(
    reservationLifecycleSchema.safeParse({
      action: "EXTEND",
      reservationId: "reservation-1",
      holdExpiresAt: "2026-09-03T21:59:59.999Z",
      reason: "Customer requested two more days",
    }).success,
    true,
  );
  assert.equal(
    reservationLifecycleSchema.safeParse({
      action: "EXTEND",
      reservationId: "reservation-1",
      holdExpiresAt: "not-a-date",
      reason: "Customer requested two more days",
    }).success,
    false,
  );
  assert.equal(
    reservationLifecycleSchema.safeParse({
      action: "EXPIRE",
      reservationId: "reservation-1",
      reason: "",
    }).success,
    false,
  );
});

test("reservation extension and expiry are scoped, audited and release units safely", () => {
  const service = fs.readFileSync("src/lib/leasing-service.ts", "utf8");
  const route = fs.readFileSync("src/app/api/v1/reservations/route.ts", "utf8");
  const workspace = fs.readFileSync(
    "src/components/reservations-workspace.tsx",
    "utf8",
  );

  assert.match(
    route,
    /requirePermission\("reservations\.manage", reservation\.facilityId\)/,
  );
  assert.match(service, /reservation\.extended/);
  assert.match(service, /reservation\.expired/);
  assert.match(service, /pendingOrActiveOccupancies/);
  assert.match(service, /verificationCodeHash: null/);
  assert.match(workspace, /onClick=\{\(\) => void extend\(item\)\}/);
  assert.match(workspace, /onClick=\{\(\) => void expire\(item\)\}/);
});
