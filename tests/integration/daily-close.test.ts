import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { recordDailyClose } from "../../src/lib/daily-close-service";
import type { Prisma } from "../../src/generated/prisma/client";

test("isolated PostgreSQL daily-close snapshot integrity", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Close CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Synthetic close facility" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic closer", email: `${key}@example.invalid` } });
  const input = { facilityId: facility.id, businessDate: "2026-01-01", expectedCash: 0.1, countedCash: 0.3, checks: [{ key: "review", label: "Synthetic attestation", complete: true }] };
  try {
    await t.test("closed snapshot cannot be replaced and retains one audit", async () => {
      const first = await recordDailyClose(org.id, user.id, input);
      assert.equal(first.variance?.toFixed(2), "0.20");
      await assert.rejects(recordDailyClose(org.id, user.id, { ...input, countedCash: 99 }), /ALREADY_CLOSED/);
      const saved = await db.dailyClose.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(saved.countedCash?.toFixed(2), "0.30");
      assert.equal(saved.closedAt?.toISOString(), first.closedAt?.toISOString());
      assert.equal(await db.auditEvent.count({ where: { entityId: first.id, action: "dailyClose.create" } }), 1);
    });
    await t.test("concurrent creation records one close and one audit", async () => {
      const next = { ...input, businessDate: "2026-01-02" };
      const outcomes = await Promise.allSettled([recordDailyClose(org.id, user.id, next), recordDailyClose(org.id, user.id, { ...next, countedCash: 55 })]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(await db.dailyClose.count({ where: { facilityId: facility.id, businessDate: new Date("2026-01-02") } }), 1);
      const close = await db.dailyClose.findFirstOrThrow({ where: { facilityId: facility.id, businessDate: new Date("2026-01-02") } });
      assert.equal(await db.auditEvent.count({ where: { entityId: close.id } }), 1);
    });
    await t.test("existing open, ready and explicitly reopened snapshots can close once", async () => {
      for (const [index, status] of (["OPEN", "READY", "REOPENED"] as const).entries()) {
        const day = `2026-01-0${index + 3}`;
        const draft = await db.dailyClose.create({ data: { organisationId: org.id, facilityId: facility.id, businessDate: new Date(day), status, checks: [] } });
        const outcomes = await Promise.allSettled([recordDailyClose(org.id, user.id, { ...input, businessDate: day }), recordDailyClose(org.id, user.id, { ...input, businessDate: day, countedCash: 44 })]);
        assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
        assert.equal((await db.dailyClose.findUniqueOrThrow({ where: { id: draft.id } })).status, "CLOSED");
        const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: draft.id } });
        assert.equal((audit.before as { status: string }).status, status);
        assert.equal(await db.auditEvent.count({ where: { entityId: draft.id } }), 1);
      }
    });
    await t.test("audit failure rolls back a new snapshot", async () => {
      const transaction = db.$transaction.bind(db);
      const original = db.$transaction;
      let reachedAudit = false;
      db.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => callback(new Proxy(tx, { get(target, property) {
        if (property === "auditEvent") return { ...target.auditEvent, create: async () => { reachedAudit = true; throw new Error("SYNTHETIC_AUDIT_FAILURE"); } };
        return Reflect.get(target, property);
      } })))) as typeof db.$transaction;
      try { await assert.rejects(recordDailyClose(org.id, user.id, { ...input, businessDate: "2026-01-09" }), /SYNTHETIC_AUDIT_FAILURE/); }
      finally { db.$transaction = original; }
      assert.equal(reachedAudit, true);
      assert.equal(await db.dailyClose.count({ where: { facilityId: facility.id, businessDate: new Date("2026-01-09") } }), 0);
    });
  } finally { await db.$disconnect(); }
});
