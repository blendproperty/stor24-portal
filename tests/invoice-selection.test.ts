import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { sendInvoiceEmail } from "../src/lib/finance/billing-documents-service";

test("invoice selection requires every requested entry to be an account charge before document work", async () => {
  const original = { account: db.account.findFirst, entries: db.ledgerEntry.findMany, config: db.configurationProfile.findFirst };
  const boundary = new Error("SYNTHETIC_DOCUMENT_BOUNDARY");
  let documentReads = 0;
  let rows: { id: string; type: string }[] = [];
  db.account.findFirst = (async () => ({ id: "account", accountNumber: "TEST", balance: "0", currency: "ZAR", customer: { id: "customer", email: "test@example.invalid" }, tenancy: { id: "tenancy", facilityId: "facility", facility: { name: "Synthetic" }, occupancies: [] } })) as unknown as typeof original.account;
  db.ledgerEntry.findMany = (async ({ where }: { where: { id: { in: string[] }; accountId: string } }) => {
    assert.equal(where.accountId, "account");
    return rows.filter(row => where.id.in.includes(row.id));
  }) as unknown as typeof original.entries;
  // Stop before configuration, document writes or email: no provider can be invoked.
  db.configurationProfile.findFirst = (async () => { documentReads++; throw boundary; }) as unknown as typeof original.config;
  const send = (ledgerEntryIds: string[]) => sendInvoiceEmail({ accountId: "account", organisationId: "org", actorId: "staff", ledgerEntryIds });
  try {
    for (const type of ["PAYMENT", "CREDIT", "REFUND", "REVERSAL", "WRITE_OFF"]) {
      rows = [{ id: "entry", type }];
      assert.deepEqual(await send(["entry"]), { ok: false, code: "INVALID_INVOICE_ENTRIES" }, type);
    }
    rows = [{ id: "charge", type: "CHARGE" }];
    assert.deepEqual(await send(["charge", "missing-or-other-account"]), { ok: false, code: "INVALID_INVOICE_ENTRIES" });
    assert.deepEqual(await send(["charge", "charge"]), { ok: false, code: "INVALID_INVOICE_ENTRIES" });
    assert.deepEqual(await send([]), { ok: false, code: "NO_LEDGER_ENTRIES" });
    assert.deepEqual(await send(["missing"]), { ok: false, code: "NO_LEDGER_ENTRIES" });
    rows.push({ id: "payment", type: "PAYMENT" });
    assert.deepEqual(await send(["charge", "payment"]), { ok: false, code: "INVALID_INVOICE_ENTRIES" });
    assert.equal(documentReads, 0, "invalid selections must not reach document generation");
    rows = [{ id: "charge", type: "CHARGE" }, { id: "charge2", type: "CHARGE" }];
    await assert.rejects(send(["charge2", "charge"]), error => error === boundary);
    assert.ok(documentReads > 0, "complete charge selection continues to existing generation");
  } finally {
    db.account.findFirst = original.account;
    db.ledgerEntry.findMany = original.entries;
    db.configurationProfile.findFirst = original.config;
  }
});
