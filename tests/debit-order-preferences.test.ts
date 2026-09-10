import assert from "node:assert/strict";
import test from "node:test";
import { parseDebitOrderPreferences } from "../src/lib/debit-order-preferences";
test("collection preferences accept real dates and explicit monthly days", () => {
  assert.deepEqual(parseDebitOrderPreferences({ firstCollectionDate: "2026-10-01", collectionDay: 25 }, "2026-09-11"), { firstCollectionDate: "2026-10-01", collectionDay: 25 });
});
test("collection preferences reject missing, impossible, past and malformed dates or days", () => {
  for (const value of [null, {}, { firstCollectionDate: "2026-02-30", collectionDay: 1 }, { firstCollectionDate: "2026-09-10", collectionDay: 1 },
    ...[0, 32, 1.5, "25", null].map(collectionDay => ({ firstCollectionDate: "2026-10-01", collectionDay }))]) {
    assert.equal(parseDebitOrderPreferences(value, "2026-09-11"), null);
  }
});
