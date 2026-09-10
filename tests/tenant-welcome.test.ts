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
    assert.doesNotMatch(message.html, /token=|account=|Netcash|onerror="bad"/);
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});

test("welcome eligibility, duplicate/concurrent protection, cooldown, failure and explicit resend", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://portal.example.invalid";
  let eligible = false, sentAt: Date | null = null, nextAttemptAt = 0, calls = 0, fail = false;
  const actions: string[] = [];
  const fake = {
    customer: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.id, "customer"); assert.equal(where.organisationId, "org");
      assert.deepEqual(where.emailVerifiedAt, { not: null });
      assert.deepEqual(where.OR, [{ accounts: { some: {} } }, { reservations: { some: { publicLease: { status: "SIGNED" } } } }]);
      return eligible ? { firstName: "Test", email: "Test@Example.invalid", organisation: { slug: "stor24" } } : null;
    } },
    tenantPortalWelcome: {
      upsert: async () => ({}),
      updateMany: async ({ where, data }: { where: { sentAt?: null }; data: { nextAttemptAt: Date } }) => {
        if (nextAttemptAt > Date.now() || (where.sentAt === null && sentAt)) return { count: 0 };
        nextAttemptAt = data.nextAttemptAt.getTime(); return { count: 1 };
      },
      update: async ({ data }: { data: { sentAt?: Date } }) => { if (data.sentAt) sentAt = data.sentAt; return {}; },
    }, auditEvent: { create: async ({ data }: { data: { action: string } }) => { actions.push(data.action); return {}; } },
  } as unknown as typeof db;
  const send = async (message: { to: string }) => { assert.equal(message.to, "test@example.invalid"); calls++; if (fail) throw new Error("provider error"); };
  const deliver = (resend = false) => sendTenantWelcome("customer", "org", { resend }, fake, send);
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
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});

test("staff welcome route uses permission, same-origin and account/facility scope; no arbitrary recipient", () => {
  const route = readFileSync('src/app/api/v1/accounts/[id]/welcome/route.ts', 'utf8');
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requirePermission\("billing.documents.send"\)/);
  assert.match(route, /statementAccountScope\(id, auth.organisationId, auth.allowedFacilityIds\)/);
  assert.doesNotMatch(route, /request.json\(/);
});
