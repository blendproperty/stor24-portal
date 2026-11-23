import assert from "node:assert/strict";
import test from "node:test";
import { retryBillingSerialization } from "../src/lib/billing-transaction-retry";

test("billing serialization retries rolled-back conflicts only, with a limit", async () => {
  let attempts = 0;
  assert.equal(await retryBillingSerialization(async () => { if (++attempts < 3) throw { code: "P2034" }; return "ok"; }), "ok");
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryBillingSerialization(async () => { attempts++; throw { code: "P2034" }; }));
  assert.equal(attempts, 5);
  attempts = 0;
  await assert.rejects(retryBillingSerialization(async () => { attempts++; throw new Error("other"); }), /other/);
  assert.equal(attempts, 1);
});
