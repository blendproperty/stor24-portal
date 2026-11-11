import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../src/generated/prisma/client";
import { db } from "../../src/lib/db";
import { scheduledBillingGroupHash } from "../../src/lib/scheduled-billing-group";
import { recogniseScheduledBillingCharge } from "../../src/lib/scheduled-billing-recognition";
import { buildAccountStatement } from "../../src/lib/finance/account-statement";

test("multi-line invoice credits are recognised atomically, including failures and concurrent retries", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  try {
    const org = await db.organisation.create({ data: { name: "Synthetic", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic", code: key } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2025-01-01") } });
    const content = "Synthetic invoice, never sent", sha256 = createHash("sha256").update(content).digest("hex");
    const invoice = await db.document.create({ data: { tenancyId: tenancy.id, type: "INVOICE", status: "GENERATED", storageKey: "synthetic", content, sha256 } });
    const due = new Date("2027-01-01T00:00:00+02:00");
    const base = { accountId: account.id, organisationId: org.id, facilityId: facility.id, invoiceId: invoice.id, effectiveAt: due };
    const lines = [
      { ...base, externalRef: `A-RENT-${key}`, description: "Rent", lineType: "CHARGE", amount: new Prisma.Decimal("1000.00"), taxAmount: new Prisma.Decimal("130.43") },
      { ...base, externalRef: `B-CREDIT-${key}`, description: "Synthetic credit", lineType: "CREDIT", amount: new Prisma.Decimal("100.00"), taxAmount: new Prisma.Decimal("13.04") },
      { ...base, externalRef: `C-FEE-${key}`, description: "Fee", lineType: "CHARGE", amount: new Prisma.Decimal("50.00"), taxAmount: new Prisma.Decimal("6.52") },
    ];
    const groupHash = scheduledBillingGroupHash(lines);
    await db.scheduledBillingCharge.createMany({ data: lines.map(line => ({ ...line, groupSize: lines.length, groupHash })) });
    const group = await db.scheduledBillingCharge.findMany({ where: { invoiceId: invoice.id }, orderBy: { externalRef: "asc" } });
    await assert.rejects(recogniseScheduledBillingCharge(group[0].id, new Date(due.getTime() - 1)), /NOT_DUE/);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id } }), 0);
    await db.scheduledBillingCharge.delete({ where: { id: group[2].id } });
    await assert.rejects(recogniseScheduledBillingCharge(group[0].id, due), /GROUP_REVIEW/);
    await db.scheduledBillingCharge.create({ data: { ...lines[2], id: group[2].id, groupSize: lines.length, groupHash } });
    await db.scheduledBillingCharge.update({ where: { id: group[1].id }, data: { amount: "99.00" } });
    await assert.rejects(recogniseScheduledBillingCharge(group[0].id, due), /GROUP_REVIEW/);
    await db.scheduledBillingCharge.update({ where: { id: group[1].id }, data: { amount: "100.00" } });
    await db.document.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
    await assert.rejects(recogniseScheduledBillingCharge(group[0].id, due), /GROUP_REVIEW/);
    await db.document.update({ where: { id: invoice.id }, data: { status: "GENERATED" } });
    const partial = await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: "1000.00", description: "Synthetic partial", effectiveAt: due, externalRef: `PARTIAL-${key}` } });
    await db.scheduledBillingCharge.update({ where: { id: group[0].id }, data: { recognisedAt: due, ledgerEntryId: partial.id } });
    await assert.rejects(recogniseScheduledBillingCharge(group[1].id, due), /INCONSISTENT/);
    await db.scheduledBillingCharge.update({ where: { id: group[0].id }, data: { recognisedAt: null, ledgerEntryId: null } });
    await db.ledgerEntry.delete({ where: { id: partial.id } });
    const collision = await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: "10.00", description: "Synthetic conflict", effectiveAt: due, externalRef: lines[1].externalRef } });
    await db.account.update({ where: { id: account.id }, data: { balance: { decrement: "10.00" } } });
    await assert.rejects(recogniseScheduledBillingCharge(group[0].id, due));
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id } }), 1);
    assert.equal(await db.scheduledBillingCharge.count({ where: { invoiceId: invoice.id, recognisedAt: { not: null } } }), 0);
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), "-10.00");
    await db.ledgerEntry.delete({ where: { id: collision.id } });
    await db.account.update({ where: { id: account.id }, data: { balance: { increment: "10.00" } } });
    const attempts = await Promise.allSettled([recogniseScheduledBillingCharge(group[0].id, due), recogniseScheduledBillingCharge(group[1].id, due)]);
    assert.ok(attempts.some(x => x.status === "fulfilled"));
    assert.equal((await recogniseScheduledBillingCharge(group[2].id, due)).alreadyRecognised, true);
    const posted = await db.ledgerEntry.findMany({ where: { accountId: account.id }, orderBy: { externalRef: "asc" } });
    assert.deepEqual(posted.map(row => [row.type, row.amount.toFixed(2), row.taxAmount.toFixed(2)]), [["CHARGE", "1000.00", "130.43"], ["CREDIT", "100.00", "13.04"], ["CHARGE", "50.00", "6.52"]]);
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), "950.00");
    assert.equal(buildAccountStatement(posted.map(row => ({ ...row, amount: row.amount.toString() })), new Date(0), new Date(due.getTime() + 1)).closingBalance, "950.00");
    assert.equal(await db.scheduledBillingCharge.count({ where: { invoiceId: invoice.id, recognisedAt: { not: null } } }), 3);
    assert.equal(await db.auditEvent.count({ where: { entityId: account.id, action: "billing.scheduled_charge_recognised" } }), 1);
    await db.ledgerEntry.update({ where: { id: posted[1].id }, data: { amount: "99.00" } });
    await assert.rejects(recogniseScheduledBillingCharge(group[2].id, due), /INCONSISTENT/);
  } finally { await db.$disconnect(); }
});
