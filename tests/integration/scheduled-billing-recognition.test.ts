import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { recogniseScheduledBillingCharge } from "../../src/lib/scheduled-billing-recognition";
import { buildAccountStatement } from "../../src/lib/finance/account-statement";

test("scheduled charge recognition is due-only, reconciled, atomic and retry-safe", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  try {
    const org = await db.organisation.create({ data: { name: "Synthetic", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic", code: key } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
    const due = new Date("2027-01-01T00:00:00+02:00");
    const charge = await db.scheduledBillingCharge.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, externalRef: `RENT-${key}`, description: "Synthetic rent", amount: "100.00", taxAmount: "13.04", effectiveAt: due } });
    await assert.rejects(recogniseScheduledBillingCharge(charge.id, new Date(due.getTime() - 1)), /NOT_DUE/);
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), "0.00");
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id } }), 0);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
      await tx.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: "20.00", description: "Synthetic advance", effectiveAt: new Date(due.getTime() - 1000), externalRef: `PAY-${key}` } });
      await tx.account.update({ where: { id: account.id }, data: { balance: { decrement: "20.00" } } });
    });
    const attempts = await Promise.allSettled([recogniseScheduledBillingCharge(charge.id, due), recogniseScheduledBillingCharge(charge.id, due)]);
    assert.ok(attempts.some(result => result.status === "fulfilled"));
    const retry = await recogniseScheduledBillingCharge(charge.id, due);
    assert.equal(retry.alreadyRecognised, true);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id, externalRef: charge.externalRef } }), 1);
    assert.equal(await db.auditEvent.count({ where: { entityId: account.id, action: "billing.scheduled_charge_recognised" } }), 1);
    const current = await db.account.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(current.balance.toFixed(2), "80.00");
    const entries = await db.ledgerEntry.findMany({ where: { accountId: account.id } });
    assert.equal(buildAccountStatement(entries.map(e => ({ ...e, amount: e.amount.toString() })), new Date(0), new Date(due.getTime() + 1)).closingBalance, "80.00");
    const concurrentCharge = await db.scheduledBillingCharge.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, externalRef: `CONCURRENT-${key}`, description: "Synthetic concurrent rent", amount: "30.00", taxAmount: "0", effectiveAt: due } });
    const recordPayment = () => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
      if (await tx.ledgerEntry.findFirst({ where: { accountId: account.id, externalRef: `CONCURRENT-PAY-${key}` } })) return;
      await tx.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: "5.00", description: "Synthetic concurrent payment", effectiveAt: due, externalRef: `CONCURRENT-PAY-${key}` } });
      await tx.account.update({ where: { id: account.id }, data: { balance: { decrement: "5.00" } } });
    });
    await Promise.allSettled([recogniseScheduledBillingCharge(concurrentCharge.id, due), recordPayment()]);
    await recogniseScheduledBillingCharge(concurrentCharge.id, due);
    await recordPayment();
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), "105.00");
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id, externalRef: concurrentCharge.externalRef } }), 1);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id, externalRef: `CONCURRENT-PAY-${key}` } }), 1);
    const duplicateRef = await db.scheduledBillingCharge.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, externalRef: `CONCURRENT-PAY-${key}`, description: "Synthetic duplicate reference", amount: "10.00", taxAmount: "0", effectiveAt: due } });
    await assert.rejects(recogniseScheduledBillingCharge(duplicateRef.id, due));
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), "105.00");
    assert.equal((await db.scheduledBillingCharge.findUniqueOrThrow({ where: { id: duplicateRef.id } })).recognisedAt, null);
    const second = await db.scheduledBillingCharge.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, externalRef: `SECOND-${key}`, description: "Synthetic", amount: "10.00", taxAmount: "0", effectiveAt: due } });
    await db.account.update({ where: { id: account.id }, data: { balance: { increment: "1.00" } } });
    await assert.rejects(recogniseScheduledBillingCharge(second.id, due), /RECONCILIATION/);
    assert.equal((await db.scheduledBillingCharge.findUniqueOrThrow({ where: { id: second.id } })).recognisedAt, null);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id, externalRef: second.externalRef } }), 0);
    const badScope = await db.scheduledBillingCharge.create({ data: { accountId: account.id, organisationId: org.id, facilityId: "wrong", externalRef: `BAD-${key}`, description: "Synthetic", amount: "10.00", taxAmount: "0", effectiveAt: due } });
    await assert.rejects(recogniseScheduledBillingCharge(badScope.id, due), /SCOPE_REVIEW/);
  } finally { await db.$disconnect(); }
});
