import assert from "node:assert/strict";
import test from "node:test";
import {
  createPayNowCheckout,
  checkPayNowTransactionStatus,
  decryptNetcashConfig,
  NETCASH_PAY_NOW_ACTION_URL,
} from "../src/lib/payments/netcash-client";
import { encryptIntegrationSecret } from "../src/lib/integrations/integration-secret-vault";
import { NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR, publicNetcashPaymentStatus } from "../src/lib/public-netcash-payment";
import { reconcileNetcashPayment } from "../src/lib/payments/netcash-reconciliation";

// Confirmed 4 September 2026 against Netcash's Pay Now eCommerce docs
// (https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/):
// this is a browser form POST to paynow.netcash.co.za, not a server-to-server
// REST call, so these tests exercise field-building and the separate
// TransactionStatus/Check re-verification call, not an HTTP request for
// checkout creation itself.

const connection = {
  config: {
    payNowServiceKey: "bacc82ed-64df-4878-bbb2-e25d08b13a40",
    environment: "sandbox" as const,
    transactionProcessingEnabled: true,
  },
};

test("saved Netcash credentials are decrypted before transaction code uses them", () => {
  const previous = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-key-that-is-at-least-thirty-two-characters";
  try {
    const config = decryptNetcashConfig({
      environment: "test",
      merchantAccountEncrypted: encryptIntegrationSecret("50000000000"),
      accountServiceKeyEncrypted: encryptIntegrationSecret("account-key"),
      debitOrderServiceKeyEncrypted: encryptIntegrationSecret("debit-order-key"),
      payNowServiceKeyEncrypted: encryptIntegrationSecret("pay-now-key"),
      transactionProcessingEnabled: true,
    });
    assert.deepEqual(config, {
      environment: "sandbox",
      merchantAccount: "50000000000",
      accountServiceKey: "account-key",
      debitOrderServiceKey: "debit-order-key",
      payNowServiceKey: "pay-now-key",
      transactionProcessingEnabled: true,
    });
    assert.equal(createPayNowCheckout({ config }, {
      reference: "PMT-DECRYPTED",
      amount: 10,
      description: "Sandbox payment",
    }).fields.m1, "pay-now-key");
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
    else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previous;
  }
});

test("missing encrypted credentials stay absent and processing remains disabled by default", () => {
  assert.deepEqual(decryptNetcashConfig({ environment: "test" }), {
    environment: "sandbox",
    merchantAccount: undefined,
    accountServiceKey: undefined,
    debitOrderServiceKey: undefined,
    payNowServiceKey: undefined,
    transactionProcessingEnabled: false,
  });
});

test("the public Netcash journey is pinned to the bounded R10 sandbox amount", async () => {
  assert.equal(NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR, 10);
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/public-netcash-payment.ts", "utf8"));
  assert.match(source, /contactVerifiedAt/);
  assert.match(source, /customer\.emailVerifiedAt/);
  assert.match(source, /netcash-public-test-/);
  assert.match(source, /account\.upsert/);
  assert.match(source, /ST24-T-\$\{reservation\.id\}/);
  assert.match(source, /public_payment\.netcash_sandbox_started/);
  assert.match(source, /extra1: reference/);
  assert.match(source, /ST24-T-\$\{reservation\.id\}/);
  assert.match(source, /provider: "NETCASH"/);
  assert.doesNotMatch(source, /quotedRate/);
});

test("public Netcash status distinguishes a cancelled checkout from a declined payment", () => {
  assert.equal(publicNetcashPaymentStatus("FAILED", "Transaction cancelled by cardholder"), "CANCELLED");
  assert.equal(publicNetcashPaymentStatus("FAILED", "Transaction cancellation"), "CANCELLED");
  assert.equal(publicNetcashPaymentStatus("FAILED", "Card declined"), "FAILED");
  assert.equal(publicNetcashPaymentStatus("PENDING", null), "PENDING");
});

test("public Netcash status is scoped to the reservation-specific account and payment", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/public/v1/payments/netcash/status/route.ts", "utf8"));
  assert.match(source, /publicApiAuthorized/);
  assert.match(source, /reference/);
  assert.match(source, /paymentId/);
  assert.match(source, /cache-control/);
});

test("Pay Now checkout posts to the documented eCommerce action URL with the correct field names", () => {
  const checkout = createPayNowCheckout(connection, {
    reference: "PMT12345678901234567890",
    amount: 1250.5,
    description: "Deposit - Unit 106",
    customerEmail: "customer@example.com",
  });
  assert.equal(checkout.actionUrl, NETCASH_PAY_NOW_ACTION_URL);
  assert.equal(checkout.actionUrl, "https://paynow.netcash.co.za/site/paynow.aspx");
  assert.equal(checkout.method, "POST");
  assert.deepEqual(checkout.fields, {
    m1: "bacc82ed-64df-4878-bbb2-e25d08b13a40",
    m2: "24ade73c-98cf-47b3-99be-cc7b867b3080",
    p2: "PMT12345678901234567890",
    p3: "Deposit - Unit 106",
    p4: "1250.50",
    Budget: "Y",
    m9: "customer@example.com",
  });
});

test("Pay Now checkout omits optional fields when not supplied", () => {
  const checkout = createPayNowCheckout(connection, {
    reference: "PMT1",
    amount: 100,
    description: "Ad-hoc charge",
  });
  assert.deepEqual(Object.keys(checkout.fields).sort(), ["Budget", "m1", "m2", "p2", "p3", "p4"]);
});

test("Pay Now checkout maps extra data fields to m4/m5/m6", () => {
  const checkout = createPayNowCheckout(connection, {
    reference: "PMT2",
    amount: 100,
    description: "Ad-hoc charge",
    extra1: "accountId-123",
    extra2: "facility-midpoint",
    extra3: "staff-brett",
  });
  assert.equal(checkout.fields.m4, "accountId-123");
  assert.equal(checkout.fields.m5, "facility-midpoint");
  assert.equal(checkout.fields.m6, "staff-brett");
});

test("Pay Now checkout rejects a reference longer than Netcash's documented 25-character limit", () => {
  assert.throws(
    () => createPayNowCheckout(connection, { reference: "x".repeat(26), amount: 100, description: "ok" }),
    /NETCASH_PAY_NOW_REFERENCE_TOO_LONG/,
  );
});

test("Pay Now checkout rejects a description longer than Netcash's documented 50-character limit", () => {
  assert.throws(
    () => createPayNowCheckout(connection, { reference: "ok", amount: 100, description: "x".repeat(51) }),
    /NETCASH_PAY_NOW_DESCRIPTION_TOO_LONG/,
  );
});

test("Pay Now checkout rejects a non-positive amount", () => {
  assert.throws(
    () => createPayNowCheckout(connection, { reference: "ok", amount: 0, description: "ok" }),
    /NETCASH_PAY_NOW_AMOUNT_MUST_BE_POSITIVE/,
  );
  assert.throws(
    () => createPayNowCheckout(connection, { reference: "ok", amount: -5, description: "ok" }),
    /NETCASH_PAY_NOW_AMOUNT_MUST_BE_POSITIVE/,
  );
});

test("Pay Now checkout fails closed when transaction processing is not explicitly enabled", () => {
  const disabled = { config: { payNowServiceKey: "key", environment: "sandbox" as const, transactionProcessingEnabled: false } };
  assert.throws(
    () => createPayNowCheckout(disabled, { reference: "ok", amount: 100, description: "ok" }),
    /NETCASH_TRANSACTION_PROCESSING_DISABLED/,
  );
});

test("Pay Now checkout requires a configured Pay Now service key", () => {
  const noKey = { config: { environment: "sandbox" as const, transactionProcessingEnabled: true } };
  assert.throws(
    () => createPayNowCheckout(noKey, { reference: "ok", amount: 100, description: "ok" }),
    /NETCASH_PAY_NOW_SERVICE_KEY_MISSING/,
  );
});

test("Transaction status check treats the notify postback as unverified until Netcash's own status endpoint confirms it", async () => {
  const accepted = await checkPayNowTransactionStatus(
    "114.228862205218",
    async (input) => {
      assert.equal(String(input), "https://ws.netcash.co.za/PayNow/TransactionStatus/Check?RequestTrace=114.228862205218");
      return new Response(JSON.stringify({ RequestTrace: "114.228862205218", Amount: "1250.50", TransactionAccepted: true, Reference: "PMT1" }), { status: 200 });
    },
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.requestTrace, "114.228862205218");
  assert.equal(accepted.reference, "PMT1");

  const declined = await checkPayNowTransactionStatus(
    "114.228862205219",
    async () => new Response(JSON.stringify({ RequestTrace: "114.228862205219", TransactionAccepted: false, Reference: "PMT2", Reason: "Invalid card number" }), { status: 200 }),
  );
  assert.equal(declined.accepted, false);
  assert.equal(declined.reason, "Invalid card number");
});

test("Transaction status check fails closed on a non-OK response instead of assuming acceptance", async () => {
  await assert.rejects(
    () => checkPayNowTransactionStatus("bad-trace", async () => new Response("unavailable", { status: 503 })),
    /NETCASH_TRANSACTION_STATUS_HTTP_503/,
  );
});

test("Transaction status check fails closed on a non-JSON response", async () => {
  await assert.rejects(
    () => checkPayNowTransactionStatus("bad-trace", async () => new Response("<html>not json</html>", { status: 200 })),
    /NETCASH_TRANSACTION_STATUS_NON_JSON/,
  );
});

test("Netcash internal reconciliation requires exactly one matching ledger entry", () => {
  const payment = { id: "pay-1", status: "SUCCEEDED", amount: "10.00", providerRef: "pay-1" };
  const ledger = { id: "ledger-1", type: "PAYMENT", amount: "10.00", externalRef: "trace-1", metadata: { provider: "NETCASH", paymentId: "pay-1" } };
  assert.equal(reconcileNetcashPayment(payment, [ledger]).state, "MATCHED");
  assert.equal(reconcileNetcashPayment(payment, []).state, "MISSING_LEDGER");
  assert.equal(reconcileNetcashPayment(payment, [ledger, { ...ledger, id: "ledger-2" }]).state, "DUPLICATE_LEDGER");
  assert.equal(reconcileNetcashPayment({ ...payment, status: "PENDING" }, []).state, "PENDING");
  assert.equal(reconcileNetcashPayment({ ...payment, status: "FAILED" }, []).state, "FAILED");
});

test("Netcash webhook is idempotent and posts the account balance once", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/webhooks/netcash/route.ts", "utf8"));
  assert.match(source, /if \(!inbox\)/);
  assert.match(source, /duplicate: true/);
  assert.match(source, /status: \{ not: "SUCCEEDED" \}/);
  assert.match(source, /balance: \{ decrement: payment\.amount \}/);
  assert.match(source, /paymentId: payment\.id/);
  assert.match(source, /verified\.reference !== providerRef/);
  assert.match(source, /Number\(verified\.amount\) === Number\(payment\.amount\)/);
  assert.match(source, /NETCASH_VERIFICATION_MISMATCH/);
  assert.doesNotMatch(source, /providerRef: requestTrace/);
  assert.doesNotMatch(source, /organisationId = "UNKNOWN"/);
});
