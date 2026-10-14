import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../../src/lib/db";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";
import { previewCardAutopayRequest, saveCardAutopayRequest, withdrawCardAutopayRequest } from "../../src/lib/payments/card-autopay-service";
import { previewCardEnrollment, issueCardEnrollment, recordCardSubscriptionOutcome, confirmCardSubscriptionSchedule, previewCardCancellation, cancelCardSubscription, cardSubscriptionSnapshot, cardSubscriptionTrace } from "../../src/lib/payments/card-autopay-enrollment-service";
import { CARD_EVENT_DOMAIN, CARD_PROVIDER_ACTION_DOMAIN, CARD_REQUEST_HISTORY_DOMAIN, readCardEvent } from "../../src/lib/payments/card-autopay-enrollment-policy";
import { readNetcashEvidence } from "../../src/lib/payments/netcash-payment-evidence-policy";
const now = new Date("2026-10-14T09:00:00Z"), schedule = { startDate: "2026-11-01", cycles: 12 };
const key = "00000000-0000-0000-0000-000000000001";
const reply = (value = "000") => new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><UpdateSubscriptionsResponse xmlns="http://tempuri.org/"><UpdateSubscriptionsResult>${value}</UpdateSubscriptionsResult></UpdateSubscriptionsResponse></s:Body></s:Envelope>`);
test("isolated PostgreSQL hosted card enrollment and distinct test receipts", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const oldFlag = process.env.CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED;
  process.env.CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED = "true";
  async function fixture() {
    const unique = randomUUID();
    const org = await db.organisation.create({ data: { name: "Synthetic card company", slug: unique } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic store", code: unique } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", email: unique + "@example.invalid", emailVerifiedAt: now } });
    const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: "101", monthlyRate: 950, status: "OCCUPIED" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: "CI-" + unique, balance: 950 } });
    const tenancy = await db.tenancy.create({ data: { accountId: account.id, customerId: customer.id, facilityId: facility.id, status: "ACTIVE", paymentMethod: "CARD", startDate: new Date("2026-01-01"), occupancies: { create: { unitId: unit.id, status: "ACTIVE", monthlyRate: 950, startDate: new Date("2026-01-01") } } } });
    await db.document.create({ data: { tenancyId: tenancy.id, type: "LEASE_AGREEMENT", status: "SIGNED", signedAt: now, externalId: unique, provider: "BLENDSIGN", storageKey: "synthetic://lease" } });
    await db.configurationProfile.create({ data: { organisationId: org.id, facilityId: facility.id, domain: "MONTHLY_BILLING", name: account.id, status: "READY", config: { firstPeriod: "2026-10", proration: "FULL_MONTH", taxPercent: 15, rentTaxable: true, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "Synthetic approval" } } });
    const invoiceReference = "INV-202610-" + account.accountNumber, content = "<html>Synthetic approved invoice R950.00</html>";
    const document = await db.document.create({ data: { tenancyId: tenancy.id, type: "INVOICE", status: "SENT", content, sha256: createHash("sha256").update(content).digest("hex"), storageKey: "synthetic://invoice", externalId: invoiceReference, idempotencyKey: `monthly-invoice:${account.id}:2026-10` } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 950, taxAmount: 123.91, description: "Synthetic rent", effectiveAt: new Date("2026-10-01T00:00:00+02:00"), externalRef: "RENT-2026-10", metadata: { billingPeriod: "2026-10", invoiceNumber: invoiceReference } } });
    await db.auditEvent.create({ data: { organisationId: org.id, facilityId: facility.id, action: "billing.month_posted", entityType: "Account", entityId: account.id, after: { documentId: document.id, total: 950 } } });
    const connection = await db.integrationConnection.create({ data: { organisationId: org.id, facilityId: facility.id, category: "PAYMENTS", provider: "NETCASH", status: "HEALTHY", config: { environment: "test", merchantAccountEncrypted: encryptIntegrationSecret("53000000000"), payNowServiceKeyEncrypted: encryptIntegrationSecret(key), transactionProcessingEnabled: true } } });
    const session = { organisationId: org.id, email: customer.email!, customerIds: [customer.id] };
    const preview = await previewCardAutopayRequest(session, account.id, schedule, now, true);
    const request = await saveCardAutopayRequest(session, account.id, schedule, preview.fingerprint, true, now, true);
    return { org, facility, customer, account, tenancy, document, connection, session, request };
  }
  async function issued() { const f = await fixture(); const p = await previewCardEnrollment(f.session, f.account.id, f.document.id, now); const enrollment = await issueCardEnrollment(f.session, f.account.id, f.document.id, p.fingerprint, true, now); return { ...f, enrollment }; }
  function evidence(reference: string, trace = randomUUID(), amount = "950.00", method = 1, accepted = true) { return { requestTrace: trace, reference, amount, accepted, raw: { RequestTrace: trace, Reference: reference, Amount: amount, TransactionAccepted: accepted, Method: method } }; }
  try {
    await t.test("hosted test form is invoice-backed, finite and source-bound without creating a charge or financial receipt", async () => {
      const f = await fixture(), before = await db.account.findUniqueOrThrow({ where: { id: f.account.id } });
      const p = await previewCardEnrollment(f.session, f.account.id, f.document.id, now);
      assert.equal(p.initialAmount, "950.00"); assert.match(p.consentText, /12 monthly payments/);
      await assert.rejects(issueCardEnrollment(f.session, f.account.id, f.document.id, p.fingerprint, false, now), /CONSENT_REQUIRED/);
      const result = await issueCardEnrollment(f.session, f.account.id, f.document.id, p.fingerprint, true, now);
      assert.equal(result.checkout.fields.m16, "1"); assert.equal(result.checkout.fields.m17, "12"); assert.equal(result.checkout.fields.m19, "2026-11-01"); assert.equal(result.checkout.fields.m20, "950.00"); assert.equal(result.checkout.fields.p4, "950.00"); assert.equal(result.checkout.fields.m15, undefined);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 1); assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } }); assert.equal(payment.status, "TEST_PENDING"); assert.equal(payment.providerOrganisationId, f.org.id); assert.equal(payment.providerFacilityId, f.facility.id);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), before.balance.toString());
      await assert.rejects(issueCardEnrollment(f.session, f.account.id, f.document.id, p.fingerprint, true, now), /ALREADY_ISSUED/);
      await assert.rejects(withdrawCardAutopayRequest(f.session, f.account.id, f.request.id), /PROVIDER_CANCELLATION_REQUIRED/);
    });
    await t.test("tenant ownership, changed source, paid invoices and live credentials cannot substitute for approved test setup", async () => {
      const f = await fixture(); await assert.rejects(previewCardEnrollment({ ...f.session, email: "other@example.invalid" }, f.account.id, f.document.id, now), /TENANT_NOT_FOUND/);
      const p = await previewCardEnrollment(f.session, f.account.id, f.document.id, now);
      await db.document.update({ where: { id: f.document.id }, data: { status: "GENERATED" } });
      await assert.rejects(issueCardEnrollment(f.session, f.account.id, f.document.id, p.fingerprint, true, now), /UNPAID_INVOICE_REQUIRED/);
      await db.document.update({ where: { id: f.document.id }, data: { status: "SENT" } });
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 950, description: "Synthetic paid invoice", effectiveAt: now } }); await db.account.update({ where: { id: f.account.id }, data: { balance: 0 } });
      await assert.rejects(previewCardEnrollment(f.session, f.account.id, f.document.id, now), /ALLOCATION_REVIEW/);
      await db.integrationConnection.update({ where: { id: f.connection.id }, data: { config: { environment: "live", merchantAccountEncrypted: encryptIntegrationSecret("53000000000"), payNowServiceKeyEncrypted: encryptIntegrationSecret(key), transactionProcessingEnabled: true } } });
      await assert.rejects(previewCardEnrollment(f.session, f.account.id, f.document.id, now), /SANDBOX_CONFIGURATION_REQUIRED/);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
    });
    await t.test("different verified traces create separate receipts, and repeated deliveries never post balances or invented periods", async () => {
      const f = await issued(), first = evidence(f.enrollment.paymentId);
      const r1 = await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, first, now);
      const r2 = await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId), new Date("2026-11-01T10:00:00Z"));
      const r3 = await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId), new Date("2026-12-01T10:00:00Z"));
      assert.equal(new Set([r1!.paymentId, r2!.paymentId, r3!.paymentId]).size, 3);
      await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, first, now);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 3); assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      const events = await db.configurationProfile.findMany({ where: { organisationId: f.org.id, domain: CARD_EVENT_DOMAIN } }); assert.equal(events.length, 3);
      for (const row of events) { const event = readCardEvent(row.config, { organisationId: f.org.id, accountId: f.account.id }); assert.equal(event.billingPeriod, null); assert.equal(event.allocation, "UNALLOCATED"); assert.notEqual(event.traceEncrypted, first.requestTrace); }
      const child = await db.payment.findUniqueOrThrow({ where: { id: r2!.paymentId } }); assert.equal(child.providerRef, null); assert.equal(child.providerOriginalRef, f.enrollment.paymentId);
      const classification = await db.configurationProfile.findUniqueOrThrow({ where: { id: `netcash-evidence:${child.id}` } }); assert.equal(readNetcashEvidence(classification.config, child)?.method, "Credit card");
      const parent = await db.payment.findUniqueOrThrow({ where: { id: r1!.paymentId } }); assert.equal(await cardSubscriptionTrace(f.org.id, f.account.id, parent.id, parent.providerRequestTraceHash!), first.requestTrace);
      const snapshot = await cardSubscriptionSnapshot(f.session, f.account.id); assert.equal(JSON.stringify(snapshot).includes(first.requestTrace), false); assert.equal(snapshot.events.length, 3);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "950.00");
    });
    await t.test("wrong provider reference is refused; an unexpected positive amount is retained for review rather than disappearing", async () => {
      const f = await issued(); await assert.rejects(recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence("other-reference"), now), /PROVIDER_MISMATCH/);
      const result = await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId, randomUUID(), "1.00"), now);
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: result!.paymentId } })).amount.toFixed(2), "1.00");
      assert.equal((await db.configurationProfile.findUniqueOrThrow({ where: { id: f.enrollment.subscriptionId } })).status, "PROVIDER_SOURCE_REVIEW");
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
    });
    await t.test("future schedule confirmation uses one durable provider attempt and preserves the customer's exact approved terms", async () => {
      const f = await issued(); await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId), now);
      let calls = 0; const provider: typeof fetch = async (_, init) => { calls++; assert.match(String(init!.body), /<M19>20261101<\/M19><M20>950.00<\/M20><Active>true<\/Active>/); return reply(); };
      const results = await Promise.allSettled([confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, provider, now), confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, provider, now)]);
      assert.ok(results.some(result => result.status === "fulfilled" && result.value.providerAccepted)); assert.equal(calls, 1);
      await confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, provider, now); assert.equal(calls, 1);
      assert.equal((await db.configurationProfile.findUniqueOrThrow({ where: { id: f.enrollment.subscriptionId } })).status, "SCHEDULE_ACCEPTED");
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: CARD_PROVIDER_ACTION_DOMAIN, status: "PROVIDER_ACCEPTED" } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
    });
    await t.test("uncertain schedule outcome cannot replay; a passed start date cannot trigger catch-up or reset cycles", async () => {
      const f = await issued(); await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId), now);
      let calls = 0; const provider: typeof fetch = async () => { calls++; throw Error("Synthetic timeout"); };
      assert.equal((await confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, provider, now)).status, "SCHEDULE_CONFIRMATION_UNCERTAIN");
      await confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, provider, now); assert.equal(calls, 1);
      const late = await issued(); await recordCardSubscriptionOutcome(late.org.id, late.enrollment.paymentId, evidence(late.enrollment.paymentId), now);
      assert.equal((await confirmCardSubscriptionSchedule(late.org.id, late.enrollment.paymentId, provider, new Date("2026-11-01T10:00:00Z"))).status, "SOURCE_REVIEW"); assert.equal(calls, 1);
    });
    await t.test("cancellation is owned, reviewed, single-attempt, source-bound and separate from refunds or account postings", async () => {
      const f = await issued(); await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, evidence(f.enrollment.paymentId), now);
      await confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, async () => reply(), now);
      await assert.rejects(previewCardCancellation({ ...f.session, customerIds: [] }, f.enrollment.subscriptionId), /TENANT_NOT_FOUND/);
      const preview = await previewCardCancellation(f.session, f.enrollment.subscriptionId); let calls = 0;
      await assert.rejects(cancelCardSubscription(f.session, f.enrollment.subscriptionId, preview.fingerprint, false), /CONSENT_REQUIRED/);
      const result = await cancelCardSubscription(f.session, f.enrollment.subscriptionId, preview.fingerprint, true, async (_, init) => { calls++; assert.match(String(init!.body), /<Active>false<\/Active>/); return reply(); });
      assert.equal(result.status, "CANCELLATION_ACCEPTED"); assert.equal(calls, 1);
      await assert.rejects(cancelCardSubscription(f.session, f.enrollment.subscriptionId, preview.fingerprint, true, async () => { calls++; return reply(); }), /CANCELLATION_REVIEW/); assert.equal(calls, 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1); assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "950.00");
    });
    await t.test("renewing a withdrawn preparation retains the previous terms instead of erasing them", async () => {
      const f = await fixture(); await withdrawCardAutopayRequest(f.session, f.account.id, f.request.id);
      const p = await previewCardAutopayRequest(f.session, f.account.id, { ...schedule, cycles: 6 }, now, true);
      await saveCardAutopayRequest(f.session, f.account.id, { ...schedule, cycles: 6 }, p.fingerprint, true, now, true);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: CARD_REQUEST_HISTORY_DOMAIN } }), 1);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: "CARD_AUTOPAY_REQUEST", status: "REQUESTED" } }), 1);
    });
    await t.test("a callback conflict cannot erase a claimed cancellation or allow a second provider attempt", async () => {
      const f = await issued(), first = evidence(f.enrollment.paymentId);
      await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, first, now);
      await confirmCardSubscriptionSchedule(f.org.id, f.enrollment.paymentId, async () => reply(), now);
      const preview = await previewCardCancellation(f.session, f.enrollment.subscriptionId);
      let calls = 0, started!: () => void, finish!: () => void;
      const called = new Promise<void>(resolve => { started = resolve; }), hold = new Promise<void>(resolve => { finish = resolve; });
      const cancelling = cancelCardSubscription(f.session, f.enrollment.subscriptionId, preview.fingerprint, true, async () => { calls++; started(); await hold; return reply(); });
      await called;
      await recordCardSubscriptionOutcome(f.org.id, f.enrollment.paymentId, { ...first, raw: { ...first.raw, Method: 4 } }, now);
      await assert.rejects(previewCardCancellation(f.session, f.enrollment.subscriptionId), /CANCELLATION_REVIEW/);
      finish(); await cancelling; assert.equal(calls, 1);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: CARD_PROVIDER_ACTION_DOMAIN, name: `${f.enrollment.subscriptionId}:cancel` } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
    });
  } finally {
    if (oldFlag === undefined) delete process.env.CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED; else process.env.CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED = oldFlag;
    await db.$disconnect();
  }
});
