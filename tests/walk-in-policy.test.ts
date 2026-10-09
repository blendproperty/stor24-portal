import test from "node:test";
import assert from "node:assert/strict";
import { walkInToken, walkInTokenHash, walkInUsable } from "../src/lib/walk-in-policy";
test("walk-in credentials are independent, bounded and stored as hashes", () => {
  const first = walkInToken(), second = walkInToken();
  assert.match(first, /^[a-f0-9]{64}$/); assert.notEqual(first, second);
  assert.notEqual(walkInTokenHash(first), first); assert.equal(walkInTokenHash(first), walkInTokenHash(first));
  for (const invalid of ["", "x".repeat(64), first + "x"]) assert.throws(() => walkInTokenHash(invalid), /WALK_IN_UNAVAILABLE/);
});
test("closed, expired or inactive visits cannot be used", () => {
  const now = new Date(), visit = { status: "READY", expiresAt: new Date(now.getTime() + 1000), facility: { active: true, publicBookingEnabled: true }, createdBy: { active: true } };
  assert.equal(walkInUsable(visit, now), true);
  for (const changed of [{ ...visit, status: "CLOSED" }, { ...visit, expiresAt: now }, { ...visit, createdBy: { active: false } }, { ...visit, facility: { active: true, publicBookingEnabled: false } }]) assert.equal(walkInUsable(changed, now), false);
  assert.equal(walkInUsable(null), false);
});
