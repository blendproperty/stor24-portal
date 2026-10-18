import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { actPhoneNotice, previewPhoneNotice, COLLECTION_PHONE_DOMAIN } from "../../src/lib/collection-phone-service";
import { smsPayload } from "../../src/lib/collection-phone-policy";
import { historyEvidence } from "../../src/lib/customer-history-message-policy";

test("isolated phone notices: real claims, authority, consent and immutable reviewed bodies", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "phone-notice-isolated-ci-key-at-least-32-characters";
  process.env.AUTH_SECRET = "phone-notice-isolated-ci-auth-at-least-32-characters";
  process.env.APP_URL = "https://portal.example.invalid";
  process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32); process.env.TWILIO_AUTH_TOKEN = "phone-isolated-provider-token-32-characters";
  process.env.TWILIO_SMS_FROM = "+15005550006"; process.env.TWILIO_WHATSAPP_FROM = "+15005550006";
  process.env.ARREARS_SMS_ENABLED = "true"; process.env.ARREARS_WHATSAPP_ENABLED = "true"; process.env.WHATSAPP_AUTOMATION_ENABLED = "true";
  process.env.ARREARS_WHATSAPP_CONTENT_SID = "HX" + "b".repeat(32);
  process.env.ARREARS_WHATSAPP_VARIABLE_MAP = JSON.stringify({ "1": "account", "2": "store", "3": "amount", "4": "date", "5": "portal" });
  let sends = 0, responseMode = "accepted", templateBody = "", beforeResponse: (() => Promise<void>) | null = null;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://content.twilio.com/v1/Content/")) return Response.json(url.endsWith("/ApprovalRequests") ? { sid: process.env.ARREARS_WHATSAPP_CONTENT_SID, account_sid: process.env.TWILIO_ACCOUNT_SID, whatsapp: { status: "approved", category: "UTILITY", content_type: "twilio/text" } } : { sid: process.env.ARREARS_WHATSAPP_CONTENT_SID, account_sid: process.env.TWILIO_ACCOUNT_SID, language: "en", types: { "twilio/text": { body: templateBody } } });
    if (!url.startsWith("https://api.twilio.com/2010-04-01/Accounts/") || !url.endsWith("/Messages.json") || init?.method !== "POST") throw Error("Unexpected provider request");
    sends++; if (beforeResponse) await beforeResponse();
    if (responseMode === "throw") throw Error("Uncertain provider outcome");
    return Response.json({ sid: "SM" + "c".repeat(32) });
  };
  async function fixture() {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "Phone CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Phone CI store" } });
    const users = await Promise.all([0, 1, 2].map(i => db.user.create({ data: { organisationId: org.id, name: `Phone CI ${i}`, email: randomUUID() + "@example.invalid" } })));
    const role = await db.role.create({ data: { organisationId: org.id, name: "Phone reviewer", permissions: ["collections.view", "collections.manage", "billing.documents.send", "communications.view", "customer_history.export"] } });
    await db.roleAssignment.createMany({ data: users.map(u => ({ roleId: role.id, userId: u.id, facilityId: facility.id })) });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Phone CI", phone: "+27821234567", phoneVerifiedAt: new Date(), communicationConsent: { sms: true, whatsapp: true } } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: "PHONE-CI-" + key, balance: 100 } });
    await db.tenancy.create({ data: { customerId: customer.id, accountId: account.id, facilityId: facility.id, status: "ACTIVE", paymentMethod: "EFT", startDate: new Date("2026-01-01") } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "CI original rent", effectiveAt: new Date("2026-01-01") } });
    await db.collectionCase.create({ data: { accountId: account.id, terms: { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "CI original approved terms", overrides: [] } } });
    const scopes = users.map(u => ({ organisationId: org.id, userId: u.id, facilityIds: [facility.id], unrestrictedFacilities: false }));
    process.env.ARREARS_PHONE_ORGANISATION_ID = org.id;
    await db.integrationConnection.create({ data: { organisationId: org.id, category: "MESSAGING", provider: "TWILIO_WHATSAPP", status: "CONFIGURED", config: { automationEnabled: true } } });
    return { org, facility, users, role, customer, account, a: scopes[0], b: scopes[1], c: scopes[2] };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function prepare(f: Fixture, channel: "SMS" | "WHATSAPP" = "SMS") {
    const p = await previewPhoneNotice(f.a, f.account.id, channel); assert.deepEqual(p.blockers, []);
    return actPhoneNotice(f.a, { action: "prepare", accountId: f.account.id, channel, fingerprint: p.source.fingerprint });
  }
  async function approve(f: Fixture, channel: "SMS" | "WHATSAPP" = "SMS") {
    const draft = (await prepare(f, channel)).notice!;
    return actPhoneNotice(f.b, { action: "approve", accountId: f.account.id, channel, id: draft.id, revision: draft.revision, reference: "CI independent recipient and complete-body review" });
  }
  const send = (f: Fixture, n: NonNullable<Awaited<ReturnType<typeof previewPhoneNotice>>["notice"]>, channel: "SMS" | "WHATSAPP" = "SMS") => actPhoneNotice(f.a, { action: "send", accountId: f.account.id, channel, id: n.id, revision: n.revision, confirm: true });
  try {
    await t.test("two overlapping staff sends produce one durable log and one provider request; money unchanged", async () => {
      const f = await fixture(), ready = (await approve(f)).notice!, beforeLedger = await db.ledgerEntry.findMany({ where: { accountId: f.account.id } }), count = sends;
      const results = await Promise.allSettled([send(f, ready), send(f, ready)]); assert.ok(results.some(r => r.status === "fulfilled"));
      assert.equal(sends - count, 1); assert.equal((await previewPhoneNotice(f.a, f.account.id, "SMS")).notice!.status, "ACCEPTED");
      const logs = await db.communicationLog.findMany({ where: { organisationId: f.org.id } }); assert.equal(logs.length, 1); assert.equal(logs[0].messageType, "COLLECTION_REMINDER"); assert.equal(logs[0].status, "PROCESSING"); assert.equal(logs[0].nextRetryAt, null); assert.deepEqual((logs[0].metadata as { historyEvidence: unknown }).historyEvidence, historyEvidence(ready));
      await send(f, ready); assert.equal(sends - count, 1); assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "100"); assert.deepEqual(await db.ledgerEntry.findMany({ where: { accountId: f.account.id } }), beforeLedger); assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "collection.phone.send_claimed" } }), 1);
    });
    await t.test("self approval and stale revisions cannot approve or dispatch", async () => {
      const f = await fixture(), n = (await prepare(f)).notice!, count = sends;
      await assert.rejects(actPhoneNotice(f.a, { action: "approve", accountId: f.account.id, channel: "SMS", id: n.id, revision: n.revision, reference: "CI self review forbidden" }), /APPROVAL/);
      await assert.rejects(send(f, n), /STAGE/); await assert.rejects(actPhoneNotice(f.b, { action: "approve", accountId: f.account.id, channel: "SMS", id: n.id, revision: randomUUID(), reference: "CI stale revision" }), /CHANGED/); assert.equal(sends, count);
    });
    await t.test("consent withdrawal, changed phone and revoked reviewer invalidate approved send before claim", async () => {
      for (const change of ["consent", "phone", "reviewer"] as const) {
        const f = await fixture(), n = (await approve(f)).notice!, count = sends;
        if (change === "consent") await db.customer.update({ where: { id: f.customer.id }, data: { communicationConsent: { sms: false } } });
        if (change === "phone") await db.customer.update({ where: { id: f.customer.id }, data: { phone: "+27821234568" } });
        if (change === "reviewer") await db.user.update({ where: { id: f.b.userId }, data: { active: false } });
        await assert.rejects(send(f, n)); assert.equal(sends, count); assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      }
    });
    await t.test("pending/failed payments and dispute holds block preparation", async () => {
      for (const change of ["pending", "failed", "dispute"] as const) {
        const f = await fixture();
        if (change === "dispute") await db.collectionCase.update({ where: { accountId: f.account.id }, data: { disputed: true, disputeReason: "CI dispute" } });
        else await db.payment.create({ data: { accountId: f.account.id, amount: 100, status: change === "pending" ? "PENDING" : "FAILED", method: "EFT", idempotencyKey: randomUUID() } });
        const p = await previewPhoneNotice(f.a, f.account.id, "SMS"); assert.ok(p.blockers.length > 0); await assert.rejects(actPhoneNotice(f.a, { action: "prepare", accountId: f.account.id, channel: "SMS", fingerprint: p.source.fingerprint }), /HOLD/);
      }
    });
    await t.test("dedicated flags and organisation boundary cannot be bypassed with approved records", async () => {
      const f = await fixture(), n = (await approve(f)).notice!, count = sends;
      process.env.ARREARS_SMS_ENABLED = "false"; await assert.rejects(send(f, n), /STAGE/); process.env.ARREARS_SMS_ENABLED = "true";
      process.env.ARREARS_PHONE_ORGANISATION_ID = "cm00000000000000000000001"; await assert.rejects(send(f, n), /STAGE/); assert.equal(sends, count);
    });
    await t.test("cross-store scopes and foreign-organisation owner assignments do not authorise contact", async () => {
      const f = await fixture(), other = await db.facility.create({ data: { organisationId: f.org.id, name: "Other CI", code: randomUUID() } });
      await assert.rejects(previewPhoneNotice({ ...f.a, facilityIds: [other.id] }, f.account.id, "SMS"));
      const strangerOrg = await db.organisation.create({ data: { name: "Foreign CI", slug: randomUUID() } }), foreignOwner = await db.role.create({ data: { organisationId: strangerOrg.id, name: "Organisation owner", permissions: ["*"] } });
      await db.roleAssignment.deleteMany({ where: { userId: f.c.userId } }); await db.roleAssignment.create({ data: { roleId: foreignOwner.id, userId: f.c.userId, facilityId: null } });
      await assert.rejects(previewPhoneNotice({ ...f.c, unrestrictedFacilities: true }, f.account.id, "SMS"), /FORBIDDEN/);
    });
    await t.test("an uncertain provider result stays held and cannot be retried or cancelled", async () => {
      const f = await fixture(), n = (await approve(f)).notice!, count = sends; responseMode = "throw";
      try { const result = await send(f, n); assert.equal(result.notice!.status, "REVIEW_REQUIRED"); await send(f, n); assert.equal(sends - count, 1); await assert.rejects(actPhoneNotice(f.b, { action: "cancel", accountId: f.account.id, channel: "SMS", id: n.id, revision: n.revision, reference: "CI no retry via cancellation" })); }
      finally { responseMode = "accepted"; }
    });
    await t.test("an earlier-day uncertain reminder holds another channel without a new send", async () => {
      for (const channel of ["EMAIL", "WHATSAPP"]) {
        const f = await fixture(), count = sends;
        await db.communicationLog.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, customerId: f.customer.id, channel, messageType: "COLLECTION_REMINDER", recipientHash: "ci-uncertain", idempotencyKey: randomUUID(), status: "PENDING", queuedAt: new Date("2026-01-01"), nextRetryAt: null, metadata: { deliveryOutcome: "IN_PROGRESS" } } });
        const p = await previewPhoneNotice(f.a, f.account.id, "SMS");
        assert.ok(p.blockers.some(b => b.includes("earlier arrears reminder")));
        await assert.rejects(actPhoneNotice(f.a, { action: "prepare", accountId: f.account.id, channel: "SMS", fingerprint: p.source.fingerprint }), /HOLD/);
        assert.equal(sends, count); assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: COLLECTION_PHONE_DOMAIN } }), 0);
      }
    });
    await t.test("audit rollback before a claim creates no communication or provider attempt", async () => {
      const f = await fixture(), n = (await approve(f)).notice!, count = sends; let installed = false;
      try { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_phone_claim_failure CHECK (false) NOT VALID'); installed = true; await assert.rejects(send(f, n)); assert.equal(sends, count); assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0); assert.equal((await db.configurationProfile.findUniqueOrThrow({ where: { id: n.id } })).status, "APPROVED"); }
      finally { if (installed) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_phone_claim_failure'); }
    });
    await t.test("accepted persistence failure retains SENDING and blocks all replay", async () => {
      const f = await fixture(), n = (await approve(f)).notice!, count = sends; let installed = false;
      beforeResponse = async () => { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_phone_final_failure CHECK (false) NOT VALID'); installed = true; };
      try { assert.equal((await send(f, n)).notice!.status, "SENDING"); beforeResponse = null; await send(f, n); assert.equal(sends - count, 1); assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: n.id } })).status, "PENDING"); }
      finally { beforeResponse = null; if (installed) await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_phone_final_failure'); }
    });
    await t.test("WhatsApp freezes the actual approved text and refuses changed templates or existing disabled provider gate", async () => {
      const f = await fixture(), p = await previewPhoneNotice(f.a, f.account.id, "SMS"), s = { ...p.source, channel: "SMS" as const };
      templateBody = smsPayload(s).text.replace(s.accountNumber, "{{1}}").replace(s.facility, "{{2}}").replace("100.00", "{{3}}").replace(s.asOf, "{{4}}").replace("https://portal.example.invalid/my", "{{5}}");
      const n = (await approve(f, "WHATSAPP")).notice!, count = sends;
      templateBody += " Changed template."; await assert.rejects(send(f, n, "WHATSAPP"), /HOLD/); assert.equal(sends, count);
      templateBody = templateBody.replace(" Changed template.", ""); process.env.WHATSAPP_AUTOMATION_ENABLED = "false"; await assert.rejects(send(f, n, "WHATSAPP"), /STAGE/); process.env.WHATSAPP_AUTOMATION_ENABLED = "true";
      const accepted = await send(f, n, "WHATSAPP"); assert.equal(accepted.notice!.status, "ACCEPTED"); assert.equal(sends - count, 1); assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: n.id } })).channel, "WHATSAPP");
    });
    await t.test("signed envelope corruption cannot release retained bodies or approve a notice", async () => {
      const f = await fixture(), n = (await prepare(f)).notice!, row = await db.configurationProfile.findUniqueOrThrow({ where: { id: n.id } });
      await db.configurationProfile.update({ where: { id: n.id }, data: { config: { ...row.config as object, integrity: "0".repeat(64) } } }); await assert.rejects(previewPhoneNotice(f.a, f.account.id, "SMS"), /INTEGRITY/);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: COLLECTION_PHONE_DOMAIN } }), 1);
    });
  } finally { globalThis.fetch = nativeFetch; await db.$disconnect(); }
});
