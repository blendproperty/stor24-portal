import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { moveIn, completeBlendSignEnvelope } from "../../src/lib/leasing-service";
import { POST } from "../../src/app/api/webhooks/blendsign/route";

test.after(async () => { await db.$disconnect(); });

test("BlendSign webhook replay, failure recovery and concurrent completion", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.BLENDSIGN_WEBHOOK_SECRET = "isolated-test-secret";
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Signing test", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Test", code: key } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Test", email: `${key}@example.invalid` } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Test" } });
  const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Test" } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: key, monthlyRate: 100 } });
  const scope = { organisationId: org.id, userId: staff.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  await db.auditEvent.create({ data: { organisationId: org.id, actorId: staff.id, action: "customer.created", entityType: "Customer", entityId: customer.id } });
  const draft = await moveIn(scope, { facilityId: facility.id, customerId: customer.id, unitId: unit.id, startDate: new Date(), initialCharge: 100, accessState: "PENDING", paymentMethod: "EFT", simulation: true });
  const envelope = `synthetic-${key}`;
  await db.document.update({ where: { id: draft.document.id }, data: { type: "LEASE_AGREEMENT", status: "SENT", externalId: envelope } });
  const request = (id: string, signature = true) => {
    const body = JSON.stringify({ id, event: "envelope.completed", data: { envelopeId: envelope } });
    return new Request("http://localhost/api/webhooks/blendsign", { method: "POST", body, headers: { "x-blendsign-event": "envelope.completed", "x-blendsign-signature": signature ? `sha256=${createHmac("sha256", "isolated-test-secret").update(body).digest("hex")}` : "bad" } });
  };
  try {
    assert.equal((await POST(request("invalid", false) as never)).status, 401);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: draft.document.id } })).status, "SENT");
    await db.occupancy.updateMany({ where: { tenancyId: draft.tenancy.id }, data: { status: "ACTIVE" } });
    await assert.rejects(POST(request("retry") as never), /CONFLICT/);
    assert.equal((await db.webhookInbox.findFirstOrThrow({ where: { organisationId: org.id, externalEventId: "retry" } })).status, "FAILED");
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: draft.document.id } })).status, "SENT");
    await db.occupancy.updateMany({ where: { tenancyId: draft.tenancy.id }, data: { status: "PENDING" } });
    await db.webhookInbox.create({ data: { organisationId: org.id, facilityId: facility.id, provider: "BLENDSIGN", eventType: "envelope.completed", externalEventId: "other", payload: { id: "other" }, status: "FAILED" } });
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => { ready = resolve; });
    const unblock = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${facility.id} FOR UPDATE`; ready(); await unblock; }, { timeout: 15000 });
    await held;
    const pending = Promise.all([POST(request("retry") as never), POST(request("other") as never)]);
    let overlap = false;
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%FROM "Facility"%' AND query LIKE '%FOR UPDATE%'`;
        if (rows[0].count >= 2) { overlap = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } finally { release(); }
    await blocker;
    const results = await pending;
    assert.equal(overlap, true, "both completions reached the facility lock concurrently");
    assert.ok(results.every(response => response.status === 200));
    assert.equal(await db.auditEvent.count({ where: { entityId: draft.document.id, action: "tenancy.blendsign_completed" } }), 1);
    assert.equal((await POST(request("retry") as never)).status, 200);
    const duplicates = await Promise.allSettled(Array.from({ length: 8 }, () => POST(request("same-event") as never)));
    assert.ok(duplicates.every(result => result.status === "fulfilled" && [200, 503].includes(result.value.status)), "concurrent duplicates succeed or request retry");
    assert.equal(await db.webhookInbox.count({ where: { organisationId: org.id, externalEventId: "same-event" } }), 1);
    assert.equal((await POST(request("same-event") as never)).status, 200);
    assert.equal((await completeBlendSignEnvelope(envelope)).idempotent, true);
    assert.equal((await db.tenancy.findUniqueOrThrow({ where: { id: draft.tenancy.id } })).status, "DRAFT");
    assert.equal((await db.occupancy.findFirstOrThrow({ where: { tenancyId: draft.tenancy.id } })).status, "PENDING");
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "RESERVED");
  } finally {
    await db.$disconnect();
  }
});
