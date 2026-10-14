import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/lib/integrations/integration-secret-vault";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { prepareCardAutopay, type CardAutopayCustomer } from "./card-autopay-service";
import { cardAutopayProviderFields, cardAutopayScheduleSchema } from "./card-autopay-policy";
import { createPayNowCheckout, getNetcashConnection } from "./netcash-client";
import { merchantIdentity } from "./netcash-statement";
import { CARD_SUBSCRIPTION_DOMAIN, CARD_EVENT_DOMAIN, CARD_PROVIDER_ACTION_DOMAIN, CARD_SUBSCRIPTION_OPEN_STATUSES, cardEnrollmentConsent, cardSourceHash, readCardSubscription, readCardEvent, signCardRecord, unpaidCardInvoice, type CardSubscriptionEvent } from "./card-autopay-enrollment-policy";
import { updatePayNowSubscription } from "./netcash-paynow-soap";
import { NETCASH_EVIDENCE_DOMAIN, netcashPaymentEvidenceValue } from "./netcash-payment-evidence-policy";
import { netcashMethodLabels } from "./netcash-methods";

type Client = Prisma.TransactionClient;
const openStatuses = CARD_SUBSCRIPTION_OPEN_STATUSES;
async function ownedAccount(client: Client, session: CardAutopayCustomer, accountId: string) {
  const account = await client.account.findFirst({ where: { id: accountId, customer: tenantCustomerScope(session), tenancy: { facility: { organisationId: session.organisationId } } }, include: { tenancy: true } });
  if (!account?.tenancy || account.tenancy.customerId !== account.customerId) throw Error("TENANT_NOT_FOUND");
  return account;
}
async function sandboxConnection(session: CardAutopayCustomer, accountId: string, requireFlag = true) {
  if (requireFlag && process.env.CARD_AUTOPAY_SANDBOX_ENROLLMENT_ENABLED !== "true") throw Error("CARD_AUTOPAY_SANDBOX_DISABLED");
  const account = await ownedAccount(db, session, accountId);
  if (requireFlag && (account.tenancy!.status !== "ACTIVE" || account.tenancy!.noticeDate || account.tenancy!.endDate)) throw Error("CARD_AUTOPAY_ACCOUNT_INELIGIBLE");
  const connection = await getNetcashConnection(session.organisationId, account.tenancy!.facilityId, true);
  const stored = await db.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
  if ((stored.config as { environment?: unknown }).environment !== "test") throw Error("CARD_AUTOPAY_SANDBOX_CONFIGURATION_REQUIRED");
  if (connection.config.environment !== "sandbox" || !connection.config.merchantAccount || !connection.config.payNowServiceKey || connection.config.transactionProcessingEnabled !== true) throw Error("CARD_AUTOPAY_SANDBOX_CONFIGURATION_REQUIRED");
  return connection;
}
export async function cardSandboxPreparationAvailable(session: CardAutopayCustomer, accountId: string) {
  await sandboxConnection(session, accountId);
  return true;
}
async function enrollmentPreview(client: Client, session: CardAutopayCustomer, accountId: string, documentId: string, connection: Awaited<ReturnType<typeof sandboxConnection>>, now: Date) {
  const account = await ownedAccount(client, session, accountId);
  const facilityId = account.tenancy!.facilityId;
  const request = await client.configurationProfile.findFirst({ where: { organisationId: session.organisationId, facilityId, domain: "CARD_AUTOPAY_REQUEST", name: accountId, status: "REQUESTED" } });
  if (!request) throw Error("CARD_AUTOPAY_REQUEST_REQUIRED");
  const stored = request.config as { schedule?: unknown; monthlyAmount?: string; fingerprint?: string; accountId?: string; customerId?: string; facilityId?: string };
  const schedule = cardAutopayScheduleSchema.parse(stored.schedule);
  const current = await prepareCardAutopay(client, session, accountId, schedule, now, true);
  if (stored.accountId !== accountId || stored.customerId !== account.customerId || stored.facilityId !== facilityId || stored.monthlyAmount !== current.monthlyAmount || !/^[a-f0-9]{64}$/.test(stored.fingerprint ?? "")) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  if (await client.configurationProfile.count({ where: { organisationId: session.organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, config: { path: ["accountId"], equals: accountId }, status: { in: openStatuses } } })) throw Error("CARD_AUTOPAY_ENROLLMENT_ALREADY_ISSUED");
  if (await client.payment.count({ where: { accountId, status: { in: ["PENDING", "TEST_PENDING"] } } })) throw Error("CARD_AUTOPAY_PENDING_PAYMENT_REVIEW");
  const document = await client.document.findFirst({ where: { id: documentId, tenancyId: account.tenancy!.id, type: "INVOICE" } });
  if (!document) throw Error("CARD_AUTOPAY_UNPAID_INVOICE_REQUIRED");
  const entries = await client.ledgerEntry.findMany({ where: { accountId }, orderBy: { effectiveAt: "asc" } });
  const invoice = unpaidCardInvoice({ accountId, balance: account.balance.toFixed(2), entries: entries.map(entry => ({ ...entry, amount: entry.amount.toFixed(2) })), document }, now);
  if (!await client.auditEvent.count({ where: { organisationId: session.organisationId, facilityId, action: "billing.month_posted", entityType: "Account", entityId: accountId, after: { path: ["documentId"], equals: document.id } } })) throw Error("CARD_AUTOPAY_APPROVED_INVOICE_REQUIRED");
  const liveConnection = await client.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
  if (liveConnection.updatedAt.getTime() !== connection.updatedAt.getTime()) throw Error("CARD_AUTOPAY_CONFIGURATION_CHANGED");
  const consentText = cardEnrollmentConsent(invoice.initialAmount, invoice.invoiceReference, current.monthlyAmount, schedule);
  const fingerprint = cardSourceHash({ current: current.fingerprint, requestId: request.id, requestUpdatedAt: request.updatedAt, invoice: invoice.sourceHash, connectionId: connection.id, connectionUpdatedAt: connection.updatedAt, consentText });
  return { accountId, customerId: account.customerId, tenancyId: account.tenancy!.id, facilityId, requestId: request.id, requestFingerprint: stored.fingerprint!, schedule, monthlyAmount: current.monthlyAmount, ...invoice, consentText, fingerprint, environment: "sandbox" as const };
}
export async function previewCardEnrollment(session: CardAutopayCustomer, accountId: string, documentId: string, now = new Date()) {
  const connection = await sandboxConnection(session, accountId);
  return db.$transaction(tx => enrollmentPreview(tx, session, accountId, documentId, connection, now), { isolationLevel: "RepeatableRead", timeout: 20000 });
}
export async function issueCardEnrollment(session: CardAutopayCustomer, accountId: string, documentId: string, fingerprint: string, accepted: boolean, now = new Date()) {
  if (accepted !== true) throw Error("CARD_AUTOPAY_ENROLLMENT_CONSENT_REQUIRED");
  const connection = await sandboxConnection(session, accountId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${accountId} FOR UPDATE`;
    const preview = await enrollmentPreview(tx, session, accountId, documentId, connection, now);
    if (preview.fingerprint !== fingerprint) throw Error("CARD_AUTOPAY_PREVIEW_CHANGED");
    const merchantHash = merchantIdentity(session.organisationId, "sandbox", connection.config.merchantAccount!);
    const payment = await tx.payment.create({ data: { accountId, amount: preview.initialAmount, currency: "ZAR", provider: "NETCASH", method: "PAY_NOW", environment: "sandbox", providerMerchantKey: merchantHash, providerFacilityId: preview.facilityId, providerOrganisationId: session.organisationId, status: "TEST_PENDING", idempotencyKey: `card-enrollment:${preview.requestId}:${fingerprint}` } });
    await tx.payment.update({ where: { id: payment.id }, data: { providerRef: payment.id } });
    const definition = signCardRecord({ version: 1 as const, accountId, customerId: preview.customerId, tenancyId: preview.tenancyId, facilityId: preview.facilityId, organisationId: session.organisationId, requestId: preview.requestId, requestFingerprint: preview.requestFingerprint, sourceFingerprint: fingerprint, checkoutPaymentId: payment.id, originalReference: payment.id, connectionId: connection.id, merchantHash, environment: "sandbox" as const, schedule: preview.schedule, monthlyAmount: preview.monthlyAmount, documentId, invoiceReference: preview.invoiceReference, invoicePeriod: preview.invoicePeriod, initialAmount: preview.initialAmount, consentText: preview.consentText, consentAt: now.toISOString() });
    readCardSubscription(definition, { organisationId: session.organisationId, accountId, facilityId: preview.facilityId });
    const subscription = await tx.configurationProfile.create({ data: { organisationId: session.organisationId, facilityId: preview.facilityId, domain: CARD_SUBSCRIPTION_DOMAIN, name: payment.id, status: "SETUP_ISSUED", config: definition } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: preview.facilityId, action: "card_autopay.enrollment_issued", entityType: "Account", entityId: accountId, after: { subscriptionId: subscription.id, paymentId: payment.id, customerId: preview.customerId, sourceFingerprint: fingerprint, consentHash: cardSourceHash(preview.consentText), isTest: true } } });
    const checkout = createPayNowCheckout(connection, { reference: payment.id, amount: Number(preview.initialAmount), description: "STOR24 monthly card test setup", customerEmail: session.email, extra1: subscription.id, extra2: "card-subscription-test", returnData: new URLSearchParams({ paymentId: payment.id, cardSetup: "test" }).toString() });
    Object.assign(checkout.fields, cardAutopayProviderFields({ reference: payment.id, approvedInitialInvoiceAmount: Number(preview.initialAmount), recurringAmount: Number(preview.monthlyAmount), schedule: preview.schedule }, now));
    return { subscriptionId: subscription.id, paymentId: payment.id, status: "SETUP_ISSUED", checkout, isTest: true };
  }, { isolationLevel: "Serializable", timeout: 20000 });
}

/** Dedicated recurring branch. Each verified provider trace is retained once.
 * Provider status has no authoritative billing date: no period or ledger is
 * inferred here. Sandbox receipts can never alter balances or issue finance exports.
 */
export async function recordCardSubscriptionOutcome(organisationId: string, originalReference: string, evidence: { requestTrace: string; reference?: string; amount?: string; accepted: boolean; raw: unknown }, now = new Date()) {
  const row = await db.configurationProfile.findFirst({ where: { organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, name: originalReference } });
  if (!row) return null;
  const definition = readCardSubscription(row.config, { organisationId });
  const body = evidence.raw as { RequestTrace?: unknown; Reference?: unknown; Amount?: unknown; TransactionAccepted?: unknown } | null;
  if (!body || typeof body !== "object" || body.RequestTrace !== evidence.requestTrace || body.Reference !== originalReference || body.Amount !== evidence.amount || typeof body.TransactionAccepted !== "boolean" || body.TransactionAccepted !== evidence.accepted) throw Error("CARD_AUTOPAY_PROVIDER_MISMATCH");
  if (definition.originalReference !== originalReference || evidence.reference !== originalReference || !/^[A-Za-z0-9.-]{8,100}$/.test(evidence.requestTrace) || !/^\d{1,6}\.\d{2}$/.test(evidence.amount ?? "")) throw Error("CARD_AUTOPAY_PROVIDER_MISMATCH");
  const amount = Number(evidence.amount).toFixed(2);
  const unexpectedAmount = amount !== definition.initialAmount && amount !== definition.monthlyAmount;
  const method = String((evidence.raw as { Method?: unknown } | null)?.Method ?? "");
  const methodCode = /^\d{1,2}$/.test(method) ? method : null;
  const traceHash = cardSourceHash(evidence.requestTrace);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${definition.accountId} FOR UPDATE`;
    const currentRow = await tx.configurationProfile.findUniqueOrThrow({ where: { id: row.id } });
    const current = readCardSubscription(currentRow.config, { organisationId, accountId: definition.accountId, facilityId: definition.facilityId });
    if (current.signature !== definition.signature) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
    const account = await tx.account.findFirst({ where: { id: definition.accountId, customerId: definition.customerId, customer: { organisationId } } });
    if (!account) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
    const checkout = await tx.payment.findUniqueOrThrow({ where: { id: definition.checkoutPaymentId } });
    if (checkout.accountId !== definition.accountId || checkout.provider !== "NETCASH" || checkout.providerRef !== originalReference || checkout.providerMerchantKey !== definition.merchantHash || checkout.providerFacilityId !== definition.facilityId || checkout.providerOrganisationId !== organisationId || checkout.environment !== "sandbox" || checkout.currency !== "ZAR") throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
    let payment = await tx.payment.findUnique({ where: { providerRequestTraceHash: traceHash } });
    if (payment && (payment.accountId !== definition.accountId || payment.providerMerchantKey !== definition.merchantHash || payment.environment !== "sandbox" || Number(payment.amount) !== Number(amount) || (payment.providerRef ?? payment.providerOriginalRef) !== originalReference)) throw Error("CARD_AUTOPAY_PROVIDER_MISMATCH");
    if (!payment && !checkout.providerRequestTraceHash && amount === definition.initialAmount && now < new Date(`${definition.schedule.startDate}T00:00:00+02:00`)) {
      payment = await tx.payment.update({ where: { id: checkout.id }, data: { providerRequestTraceHash: traceHash } });
    } else if (!payment) {
      payment = await tx.payment.create({ data: { accountId: definition.accountId, amount, currency: "ZAR", provider: "NETCASH", method: "CARD_SUBSCRIPTION", environment: "sandbox", providerOriginalRef: originalReference, providerRequestTraceHash: traceHash, providerMerchantKey: definition.merchantHash, providerFacilityId: definition.facilityId, providerOrganisationId: organisationId, status: "TEST_PENDING", idempotencyKey: `card-subscription-trace:${traceHash}` } });
    }
    const eventRow = await tx.configurationProfile.findFirst({ where: { organisationId, facilityId: definition.facilityId, domain: CARD_EVENT_DOMAIN, name: payment.id } });
    const previous = eventRow ? readCardEvent(eventRow.config, { organisationId, accountId: definition.accountId, paymentId: payment.id }) : null;
    if (previous && (previous.traceHash !== traceHash || previous.subscriptionId !== row.id || previous.originalReference !== originalReference || previous.amount !== amount)) throw Error("CARD_AUTOPAY_PROVIDER_MISMATCH");
    if (previous && (previous.methodCode !== methodCode || (previous.accepted && !evidence.accepted))) {
      await tx.configurationProfile.update({ where: { id: row.id }, data: { status: "PROVIDER_SOURCE_REVIEW" } });
      await tx.auditEvent.create({ data: { organisationId, facilityId: definition.facilityId, action: "card_autopay.provider_event_conflict", entityType: "Payment", entityId: payment.id, after: { subscriptionId: row.id, traceHash, financialMutation: false, isTest: true } } });
      return { handled: true, accepted: previous.accepted, paymentId: payment.id, isTest: true, allocation: "UNALLOCATED", reviewRequired: true };
    }
    if (previous?.accepted || (previous && !evidence.accepted)) return { handled: true, accepted: previous.accepted, paymentId: payment.id, isTest: true, allocation: "UNALLOCATED" };
    const event: CardSubscriptionEvent = signCardRecord({ version: 1 as const, organisationId, facilityId: definition.facilityId, accountId: definition.accountId, subscriptionId: row.id, paymentId: payment.id, originalReference, traceHash, traceEncrypted: previous?.traceEncrypted ?? encryptIntegrationSecret(evidence.requestTrace), merchantHash: definition.merchantHash, environment: "sandbox" as const, amount, methodCode, accepted: evidence.accepted, receivedAt: previous?.receivedAt ?? now.toISOString(), verifiedAt: now.toISOString(), allocation: "UNALLOCATED" as const, billingPeriod: null });
    if (eventRow) await tx.configurationProfile.update({ where: { id: eventRow.id }, data: { config: event, status: evidence.accepted ? "VERIFIED_TEST_RECEIPT" : "NOT_YET_ACCEPTED" } });
    else await tx.configurationProfile.create({ data: { organisationId, facilityId: definition.facilityId, domain: CARD_EVENT_DOMAIN, name: payment.id, config: event, status: evidence.accepted ? "VERIFIED_TEST_RECEIPT" : "NOT_YET_ACCEPTED" } });
    if (evidence.accepted) await tx.payment.update({ where: { id: payment.id }, data: { status: "TEST_SUCCEEDED", processedAt: now, failureCode: null } });
    const classification = netcashPaymentEvidenceValue({ paymentId: payment.id, environment: "sandbox", methodCode, accepted: evidence.accepted, amount, reference: originalReference, trace: evidence.requestTrace, merchantHash: definition.merchantHash, checkedAt: now.toISOString() });
    await tx.configurationProfile.upsert({ where: { id: `netcash-evidence:${payment.id}` }, create: { id: `netcash-evidence:${payment.id}`, organisationId, facilityId: definition.facilityId, domain: NETCASH_EVIDENCE_DOMAIN, name: payment.id, status: "VERIFIED_READ", config: classification }, update: { config: classification, status: "VERIFIED_READ" } });
    if (evidence.accepted && !["SCHEDULE_CONFIRMATION_CLAIMED", "SCHEDULE_ACCEPTED", "SCHEDULE_CONFIRMATION_UNCERTAIN", "PROVIDER_SOURCE_REVIEW", "CANCELLATION_CLAIMED", "CANCELLATION_UNCERTAIN", "CANCELLATION_ACCEPTED"].includes(currentRow.status)) await tx.configurationProfile.update({ where: { id: row.id }, data: { status: unexpectedAmount ? "PROVIDER_SOURCE_REVIEW" : methodCode !== "1" ? "PROVIDER_METHOD_REVIEW" : payment.id === checkout.id ? "INITIAL_CARD_VERIFIED" : "CARD_RECEIPTS_OBSERVED" } });
    await tx.auditEvent.create({ data: { organisationId, facilityId: definition.facilityId, action: "card_autopay.provider_event_verified", entityType: "Payment", entityId: payment.id, after: { subscriptionId: row.id, traceHash, methodCode, accepted: evidence.accepted, isTest: true, allocation: "UNALLOCATED", financialMutation: false } } });
    return { handled: true, accepted: evidence.accepted, paymentId: payment.id, isTest: true, allocation: "UNALLOCATED" };
  }, { isolationLevel: "Serializable", timeout: 20000 });
}

/** The original enrollment consent authorises these exact future terms. A
 * separate durable claim makes provider schedule acknowledgement one-attempt;
 * current/previous cycles or a passed start date cannot reset the cycle count.
 */
export async function confirmCardSubscriptionSchedule(organisationId: string, originalReference: string, request: typeof fetch = fetch, now = new Date()) {
  const row = await db.configurationProfile.findFirst({ where: { organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, name: originalReference } });
  if (!row) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  const definition = readCardSubscription(row.config, { organisationId });
  if (now >= new Date(`${definition.schedule.startDate}T00:00:00+02:00`)) return { status: "SOURCE_REVIEW", providerAccepted: false };
  const connection = await getNetcashConnection(organisationId, definition.facilityId, true);
  const stored = await db.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
  if (connection.id !== definition.connectionId || (stored.config as { environment?: unknown }).environment !== "test" || connection.config.environment !== "sandbox" || !connection.config.merchantAccount || !connection.config.payNowServiceKey || merchantIdentity(organisationId, "sandbox", connection.config.merchantAccount) !== definition.merchantHash) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${definition.accountId} FOR UPDATE`;
    const current = await tx.configurationProfile.findUniqueOrThrow({ where: { id: row.id } });
    if (!["INITIAL_CARD_VERIFIED", "CARD_RECEIPTS_OBSERVED"].includes(current.status)) return false;
    if (readCardSubscription(current.config, { organisationId }).signature !== definition.signature) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
    const account = await tx.account.findFirst({ where: { id: definition.accountId, customerId: definition.customerId, customer: { organisationId } }, include: { tenancy: true } });
    if (!account?.tenancy || account.tenancy.id !== definition.tenancyId || account.tenancy.status !== "ACTIVE" || account.tenancy.noticeDate || account.tenancy.endDate) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
    const observations = await tx.configurationProfile.findMany({ where: { organisationId, domain: CARD_EVENT_DOMAIN, AND: [{ config: { path: ["subscriptionId"], equals: row.id } }, { config: { path: ["accepted"], equals: true } }] }, take: 2 });
    if (observations.length !== 1) return false;
    const event = readCardEvent(observations[0].config, { organisationId, accountId: definition.accountId });
    if (event.methodCode !== "1" || event.amount !== definition.initialAmount || event.merchantHash !== definition.merchantHash || event.originalReference !== originalReference || new Date(event.verifiedAt) >= new Date(`${definition.schedule.startDate}T00:00:00+02:00`)) return false;
    const source = await tx.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
    if (source.updatedAt.getTime() !== connection.updatedAt.getTime()) throw Error("CARD_AUTOPAY_CONFIGURATION_CHANGED");
    const name = `${row.id}:confirm-schedule`;
    if (await tx.configurationProfile.findFirst({ where: { organisationId, facilityId: definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name } })) return false;
    await tx.configurationProfile.create({ data: { organisationId, facilityId: definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name, status: "CLAIMED", config: { subscriptionId: row.id, accountId: definition.accountId, sourceFingerprint: definition.sourceFingerprint, consentHash: cardSourceHash(definition.consentText), claimedAt: now.toISOString(), originalReference, schedule: definition.schedule, monthlyAmount: definition.monthlyAmount, isTest: true } } });
    await tx.configurationProfile.update({ where: { id: row.id }, data: { status: "SCHEDULE_CONFIRMATION_CLAIMED" } });
    await tx.auditEvent.create({ data: { organisationId, facilityId: definition.facilityId, action: "card_autopay.schedule_confirmation_claimed", entityType: "Account", entityId: definition.accountId, after: { subscriptionId: row.id, sourceFingerprint: definition.sourceFingerprint, isTest: true } } });
    return true;
  }, { isolationLevel: "Serializable", timeout: 20000 });
  if (!claim) return { status: "NO_NEW_ATTEMPT", providerAccepted: false };
  try {
    await updatePayNowSubscription(connection.config.payNowServiceKey, { originalReference, cycles: definition.schedule.cycles, startDate: definition.schedule.startDate, monthlyAmount: definition.monthlyAmount, active: true }, request);
    await db.$transaction(async tx => {
      await tx.configurationProfile.update({ where: { id: row.id }, data: { status: "SCHEDULE_ACCEPTED" } });
      await tx.configurationProfile.updateMany({ where: { organisationId, facilityId: definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name: `${row.id}:confirm-schedule`, status: "CLAIMED" }, data: { status: "PROVIDER_ACCEPTED" } });
      await tx.auditEvent.create({ data: { organisationId, facilityId: definition.facilityId, action: "card_autopay.schedule_provider_accepted", entityType: "Account", entityId: definition.accountId, after: { subscriptionId: row.id, isTest: true, providerAccepted: true, financialMutation: false } } });
    });
    return { status: "SCHEDULE_ACCEPTED", providerAccepted: true };
  } catch {
    await db.configurationProfile.update({ where: { id: row.id }, data: { status: "SCHEDULE_CONFIRMATION_UNCERTAIN" } }).catch(() => undefined);
    return { status: "SCHEDULE_CONFIRMATION_UNCERTAIN", providerAccepted: false };
  }
}

export async function cardSubscriptionSnapshot(session: CardAutopayCustomer, accountId: string) {
  const account = await ownedAccount(db, session, accountId);
  const request = await db.configurationProfile.findFirst({ where: { organisationId: session.organisationId, facilityId: account.tenancy!.facilityId, domain: "CARD_AUTOPAY_REQUEST", name: accountId } });
  const rows = await db.configurationProfile.findMany({ where: { organisationId: session.organisationId, domain: CARD_SUBSCRIPTION_DOMAIN, config: { path: ["accountId"], equals: accountId } }, orderBy: { createdAt: "desc" }, take: 30 });
  const events = await db.configurationProfile.findMany({ where: { organisationId: session.organisationId, domain: CARD_EVENT_DOMAIN, config: { path: ["accountId"], equals: accountId } }, orderBy: { createdAt: "desc" }, take: 100 });
  const documents = await db.document.findMany({ where: { tenancyId: account.tenancy!.id, type: "INVOICE", status: "SENT", idempotencyKey: `monthly-invoice:${accountId}:${southAfricaDateKey(new Date()).slice(0, 7)}` }, select: { id: true, externalId: true }, take: 5 });
  let available = false;
  try { await sandboxConnection(session, accountId); available = true; } catch { /* Existing history remains visible when creation is unavailable. */ }
  return { available, request: request ? { id: request.id, status: request.status, terms: request.config } : null, documents,
    subscriptions: rows.map(row => { const value = readCardSubscription(row.config, { organisationId: session.organisationId, accountId }); if (value.customerId !== account.customerId) throw Error("CARD_AUTOPAY_SOURCE_REVIEW"); return { id: row.id, status: row.status, monthlyAmount: value.monthlyAmount, initialAmount: value.initialAmount, invoiceReference: value.invoiceReference, schedule: value.schedule, isTest: true, consentText: value.consentText }; }),
    events: events.map(row => { const value = readCardEvent(row.config, { organisationId: session.organisationId, accountId }); return { paymentId: value.paymentId, subscriptionId: value.subscriptionId, amount: value.amount, methodCode: value.methodCode, methodLabel: netcashMethodLabels[value.methodCode ?? ""] ?? "Method needs review", accepted: value.accepted, verifiedAt: value.verifiedAt, allocation: value.allocation, billingPeriod: value.billingPeriod, isTest: true }; }), eventCoverage: "Latest 100 verified observations. Test outcomes are not financial receipts or allocated billing periods." };
}

export async function cardSubscriptionTrace(organisationId: string, accountId: string, paymentId: string, traceHash: string) {
  const row = await db.configurationProfile.findFirst({ where: { organisationId, domain: CARD_EVENT_DOMAIN, name: paymentId } });
  if (!row) throw Error("NETCASH_TRACE_UNAVAILABLE");
  const event = readCardEvent(row.config, { organisationId, accountId, paymentId });
  const trace = decryptIntegrationSecret(event.traceEncrypted);
  if (event.traceHash !== traceHash || cardSourceHash(trace) !== traceHash) throw Error("NETCASH_PAYMENT_SOURCE_REVIEW");
  return trace;
}

async function cancellationPreview(client: Client, session: CardAutopayCustomer, subscriptionId: string) {
  const row = await client.configurationProfile.findFirst({ where: { id: subscriptionId, organisationId: session.organisationId, domain: CARD_SUBSCRIPTION_DOMAIN } });
  if (!row) throw Error("TENANT_NOT_FOUND");
  const definition = readCardSubscription(row.config, { organisationId: session.organisationId });
  const account = await ownedAccount(client, session, definition.accountId);
  if (account.customerId !== definition.customerId) throw Error("TENANT_NOT_FOUND");
  if (!openStatuses.includes(row.status) || ["SCHEDULE_CONFIRMATION_CLAIMED", "SCHEDULE_CONFIRMATION_UNCERTAIN", "CANCELLATION_CLAIMED", "CANCELLATION_UNCERTAIN"].includes(row.status)) throw Error("CARD_AUTOPAY_CANCELLATION_REVIEW");
  if (await client.configurationProfile.count({ where: { organisationId: session.organisationId, domain: CARD_PROVIDER_ACTION_DOMAIN, OR: [{ name: `${row.id}:cancel` }, { name: `${row.id}:confirm-schedule`, status: { in: ["CLAIMED", "OUTCOME_UNCERTAIN"] } }] } })) throw Error("CARD_AUTOPAY_CANCELLATION_REVIEW");
  const connection = await sandboxConnection(session, definition.accountId, false);
  if (merchantIdentity(session.organisationId, "sandbox", connection.config.merchantAccount!) !== definition.merchantHash || connection.id !== definition.connectionId) throw Error("CARD_AUTOPAY_SOURCE_REVIEW");
  return { row, definition, connection, fingerprint: cardSourceHash({ signature: definition.signature, status: row.status, updatedAt: row.updatedAt, connectionUpdatedAt: connection.updatedAt }) };
}
export async function previewCardCancellation(session: CardAutopayCustomer, subscriptionId: string) {
  const preview = await cancellationPreview(db, session, subscriptionId);
  return { subscriptionId, fingerprint: preview.fingerprint, isTest: true, confirmationText: "Ask Netcash to deactivate future payments for this test subscription. Already initiated payments remain subject to reconciliation." };
}
export async function cancelCardSubscription(session: CardAutopayCustomer, subscriptionId: string, fingerprint: string, accepted: boolean, request: typeof fetch = fetch) {
  if (accepted !== true) throw Error("CARD_AUTOPAY_CANCELLATION_CONSENT_REQUIRED");
  const loaded = await cancellationPreview(db, session, subscriptionId);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${loaded.definition.accountId} FOR UPDATE`;
    const current = await cancellationPreview(tx, session, subscriptionId);
    if (current.fingerprint !== fingerprint) throw Error("CARD_AUTOPAY_PREVIEW_CHANGED");
    await tx.configurationProfile.create({ data: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name: `${subscriptionId}:cancel`, status: "CLAIMED", config: { subscriptionId, accountId: loaded.definition.accountId, originalReference: loaded.definition.originalReference, sourceFingerprint: fingerprint, customerId: loaded.definition.customerId, claimedAt: new Date().toISOString(), isTest: true } } });
    await tx.configurationProfile.update({ where: { id: subscriptionId }, data: { status: "CANCELLATION_CLAIMED" } });
    await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, action: "card_autopay.cancellation_claimed", entityType: "Account", entityId: loaded.definition.accountId, after: { subscriptionId, customerId: loaded.definition.customerId, fingerprint, isTest: true } } });
  }, { isolationLevel: "Serializable", timeout: 20000 });
  try {
    await updatePayNowSubscription(loaded.connection.config.payNowServiceKey!, { originalReference: loaded.definition.originalReference, cycles: loaded.definition.schedule.cycles, startDate: loaded.definition.schedule.startDate, monthlyAmount: loaded.definition.monthlyAmount, active: false }, request);
    await db.$transaction(async tx => {
      await tx.configurationProfile.update({ where: { id: subscriptionId }, data: { status: "CANCELLATION_ACCEPTED" } });
      await tx.configurationProfile.updateMany({ where: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name: `${subscriptionId}:cancel`, status: "CLAIMED" }, data: { status: "PROVIDER_ACCEPTED" } });
      await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, action: "card_autopay.cancellation_provider_accepted", entityType: "Account", entityId: loaded.definition.accountId, after: { subscriptionId, isTest: true, financialMutation: false } } });
    });
    return { status: "CANCELLATION_ACCEPTED", providerAccepted: true, isTest: true };
  } catch {
    await db.$transaction(async tx => {
      await tx.configurationProfile.update({ where: { id: subscriptionId }, data: { status: "CANCELLATION_UNCERTAIN" } });
      await tx.configurationProfile.updateMany({ where: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, domain: CARD_PROVIDER_ACTION_DOMAIN, name: `${subscriptionId}:cancel`, status: "CLAIMED" }, data: { status: "OUTCOME_UNCERTAIN" } });
      await tx.auditEvent.create({ data: { organisationId: session.organisationId, facilityId: loaded.definition.facilityId, action: "card_autopay.cancellation_outcome_uncertain", entityType: "Account", entityId: loaded.definition.accountId, after: { subscriptionId, isTest: true, financialMutation: false } } });
    }).catch(() => undefined);
    throw Error("CARD_AUTOPAY_CANCELLATION_OUTCOME_REVIEW");
  }
}
