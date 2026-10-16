import test from "node:test";
import assert from "node:assert/strict";
import { trainingDebtorRecord, trainingDebtorCreate } from "../src/lib/training-debtor-contract";
test("training debtor accepts only the fixed nonpostable example and no financial instruction", () => {
  const record = { version: 1, trainingOnly: true, customerId: "test", facilityId: "store", reference: "TRAINING-DEBTOR-001", chargedCents: 100000, illustrativePaidCents: 40000 };
  assert.equal(trainingDebtorRecord.parse(record).chargedCents - trainingDebtorRecord.parse(record).illustrativePaidCents, 60000);
  for (const change of [{ trainingOnly: false }, { illustrativePaidCents: 50000 }, { chargedCents: -100 }, { accountId: "live" }, { customerId: "" }]) assert.equal(trainingDebtorRecord.safeParse({ ...record, ...change }).success, false);
  assert.equal(trainingDebtorCreate.safeParse({ facilityId: "store", customerId: "existing-real-customer" }).success, false);
});
