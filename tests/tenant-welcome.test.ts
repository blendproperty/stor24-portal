import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { sendTenantWelcome, tenantWelcomeMessage } from "../src/lib/tenant-welcome-email";

test("welcome uses approved branding and a non-authenticating portal link, escaping customer content", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://portal.example.invalid";
  try {
    const message = tenantWelcomeMessage('<img onerror="bad">', "store & one", "tenant@example.invalid");
    assert.match(message.html, /stor24-logo-official-email-20260909.png/);
    assert.match(message.html, /&lt;img onerror=&quot;bad&quot;&gt;/);
    assert.match(message.html, /Open My STOR24/);
    assert.match(message.text, /organisation=store\+%26\+one/);
    assert.match(message.text, /does not confirm payment/);
    assert.match(message.text, /step=access-photo/);
    assert.match(message.html, /Prepare for move-in/);
    assert.match(message.text, /agreement and payment are verified and photo collection is open/);
    assert.doesNotMatch(message.html, /token=|account=|Netcash|onerror="bad"/);
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});

test("welcome eligibility, duplicate/concurrent protection, cooldown, failure and explicit resend", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://portal.example.invalid";
  let eligible = false, sentAt: Date | null = null, nextAttemptAt = 0, calls = 0, fail = false, attempts = 0, welcomeFailed = false;
  const actions: string[] = [];
  const fake = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(fake),
    customer: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.id, "customer"); assert.equal(where.organisationId, "org");
      assert.deepEqual(where.emailVerifiedAt, { not: null });
      assert.deepEqual(where.OR, [{ accounts: { some: {} } }, { reservations: { some: { publicLease: { status: "SIGNED" } } } }]);
      return eligible ? { firstName: "Test", email: "Test@Example.invalid", organisation: { slug: "stor24" } } : null;
    } },
    reservation: { findFirst: async ({ where }: { where: { id: string; customerId: string; customer: { organisationId: string }; facility: { organisationId: string } } }) => {
      assert.equal(where.id, "booking"); assert.equal(where.customerId, "customer"); assert.equal(where.customer.organisationId, "org"); assert.equal(where.facility.organisationId, "org");
      return { facilityId: "facility" };
    } },
    tenantPortalWelcome: {
      upsert: async () => ({}),
      updateMany: async ({ where, data }: { where: { sentAt?: null; attempts?: number; failed?: boolean }; data: { nextAttemptAt: Date } }) => {
        if (nextAttemptAt > Date.now() || (where.sentAt === null && sentAt) || (where.attempts === 0 && attempts !== 0) || (where.failed === false && welcomeFailed)) return { count: 0 };
        nextAttemptAt = data.nextAttemptAt.getTime(); attempts++; welcomeFailed = false; return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ sentAt, attempts }),
      update: async ({ data }: { data: { sentAt?: Date; failed: boolean } }) => { if (data.sentAt) sentAt = data.sentAt; welcomeFailed = data.failed; return {}; },
    }, auditEvent: { create: async ({ data }: { data: { action: string } }) => { actions.push(data.action); return {}; } },
    communicationLog: { create: async () => ({ id: "log-" + attempts }), update: async () => ({}) },
  } as unknown as typeof db;
  const send = async (message: { to: string; dlp?: { facilityId?: string } }) => { assert.equal(message.to, "test@example.invalid"); assert.equal(message.dlp?.facilityId, "facility"); calls++; if (fail) throw new Error("provider error"); };
  const deliver = (resend = false) => sendTenantWelcome("customer", "org", { resend, source: { kind: "RESERVATION", id: "booking", facilityId: "facility" } }, fake, send);
  try {
    assert.equal(await deliver(), "ineligible"); assert.equal(calls, 0);
    eligible = true;
    const results = await Promise.all([deliver(), deliver()]);
    assert.ok(results.includes("sent")); assert.equal(calls, 1);
    nextAttemptAt = 0; assert.equal(await deliver(), "already_sent_or_cooling_down");
    assert.equal(await deliver(true), "sent"); assert.equal(calls, 2);
    assert.equal(await deliver(true), "already_sent_or_cooling_down");
    nextAttemptAt = 0; fail = true;
    await assert.rejects(deliver(true), /WELCOME_DELIVERY_FAILED/);
    assert.ok(actions.includes("tenant_portal.welcome_delivery_failed"));
    assert.equal(await deliver(true), "already_sent_or_cooling_down");
    nextAttemptAt = 0; fail = false;
    assert.equal(await deliver(true), "sent");
    // A fresh identity whose first transport outcome is unknown must not be
    // automatically retried simply because its cooldown later expires.
    sentAt = null; attempts = 0; welcomeFailed = false; nextAttemptAt = 0; fail = true;
    await assert.rejects(deliver(), /WELCOME_DELIVERY_FAILED/);
    const uncertainCalls = calls;
    nextAttemptAt = 0; fail = false;
    assert.equal(await deliver(), "delivery_review_required"); assert.equal(calls, uncertainCalls);
    assert.equal(await deliver(true), "sent"); assert.equal(calls, uncertainCalls + 1);
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});

test("staff welcome route uses permission, same-origin and account/facility scope; no arbitrary recipient", () => {
  const route = readFileSync('src/app/api/v1/accounts/[id]/welcome/route.ts', 'utf8');
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requirePermission\("billing.documents.send"\)/);
  assert.match(route, /statementAccountScope\(id, auth.organisationId, auth.allowedFacilityIds\)/);
  assert.doesNotMatch(route, /request.json\(/);
});
