/**
 * Low-level Netcash REST client.
 *
 * Netcash exposes separate "service key" per product (Pay Now, Debit Order,
 * DebiCheck, eMandate, AVS, Statement). Credentials are read from this
 * organisation's IntegrationConnection row (category: "PAYMENTS", provider:
 * "NETCASH") rather than raw env vars, matching how every other external
 * provider in this repo is configured -- see IntegrationConnection in
 * prisma/schema.prisma.
 *
 * STATUS PER PRODUCT -- read this before trusting any function below.
 *
 * Pay Now eCommerce (createPayNowCheckout / checkPayNowTransactionStatus) --
 * CONFIRMED 4 September 2026 against https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/
 * and the linked TransactionStatus/Check page. This is NOT a server-to-server
 * REST call like the rest of this file -- it's a browser form POST to
 * https://paynow.netcash.co.za/site/paynow.aspx (fields m1/m2/p2/p3/p4/Budget
 * etc), and Netcash does not accept per-request ReturnUrl/CancelUrl/NotifyUrl
 * parameters for this product: those three URLs are configured once, per
 * service key, in the Netcash merchant account's Pay Now "NetConnector
 * Profile" settings. See the doc comments on each function below for exactly
 * what still needs doing in that portal before this is live-testable.
 * There is also no documented signature/hash scheme for the Notify postback
 * -- Netcash's own docs are silent on it for this product -- so
 * checkPayNowTransactionStatus() exists specifically so the webhook handler
 * can treat the POSTed body as untrusted and re-verify server-to-server via
 * RequestTrace before mutating any Payment/LedgerEntry record.
 *
 * Every other product below (eMandate, DebiCheck, standard debit order, AVS,
 * statement) is UNVERIFIED. The endpoint paths, field names and payload
 * shapes are a best-effort scaffold built from Netcash's public developer
 * docs as captured in an earlier session -- those pages could not be fully
 * read at the time (they exceeded the fetch tool's output limit). Before any
 * of those go anywhere near real money:
 *   1. Get a Netcash sandbox account and real service keys for that product.
 *   2. Confirm the actual endpoint path and field names against Netcash's
 *      current docs for that specific product page (they use different key
 *      names per product -- ServiceKey, VendorKey, SoftwareVendorKey turn up
 *      differently across products, and at least two of them -- Pay Now
 *      Billing and Scan to Pay -- turned out to be entirely different
 *      integration shapes (SOAP file-upload; GET-with-query-params) from
 *      what was guessed here for Pay Now, so don't assume this file's
 *      existing shape is a safe template for the others).
 *   3. Confirm each product's own notify/webhook callback contract.
 *   4. Run a real transaction in Netcash's sandbox end to end before
 *      enabling this for a facility.
 */
import { db } from "@/lib/db";
import { NETCASH_SOFTWARE_VENDOR_KEY } from "@/lib/integrations/netcash-configuration";

export type NetcashConfig = {
  accountServiceKey?: string; // "Account" / merchant-level service key
  payNowServiceKey?: string;
  debitOrderServiceKey?: string;
  debiCheckServiceKey?: string;
  eMandateServiceKey?: string;
  avsServiceKey?: string;
  statementServiceKey?: string;
  softwareVendorKey?: string;
  environment: "sandbox" | "live";
  transactionProcessingEnabled?: boolean;
};

const NETCASH_API_BASE = "https://api.netcash.co.za";

export async function getNetcashConnection(organisationId: string, facilityId?: string | null) {
  const connection = await db.integrationConnection.findFirst({
    where: {
      organisationId,
      facilityId: facilityId ?? null,
      category: "PAYMENTS",
      provider: "NETCASH",
    },
  });
  if (!connection) {
    throw new Error("NETCASH_NOT_CONFIGURED");
  }
  return connection;
}

function config(connection: { config: unknown }): NetcashConfig {
  const configured = connection.config as NetcashConfig;
  if (configured.transactionProcessingEnabled !== true) {
    throw new Error("NETCASH_TRANSACTION_PROCESSING_DISABLED");
  }
  return configured;
}

async function netcashRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${NETCASH_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`NETCASH_NON_JSON_RESPONSE: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`NETCASH_HTTP_${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed as T;
}

/** eMandate (synchronous) -- create a debit order mandate while the customer is present/online. */
export async function createEMandateSync(connection: { config: unknown }, params: {
  reference: string;
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  accountType: "CURRENT" | "SAVINGS" | "TRANSMISSION" | "BOND";
  idNumber?: string;
  collectionAmount: number;
  collectionDay: number; // day of month
  startDate: string; // ISO date
}) {
  const cfg = config(connection);
  return netcashRequest<{ mandateReference: string; status: string; raw: unknown }>(
    "/inbound-payments/emandate/synchronous",
    {
      ServiceKey: cfg.eMandateServiceKey,
      Reference: params.reference,
      AccountHolderName: params.accountHolderName,
      BankAccountNumber: params.bankAccountNumber,
      BranchCode: params.branchCode,
      AccountType: params.accountType,
      IdNumber: params.idNumber,
      CollectionAmount: params.collectionAmount,
      CollectionDay: params.collectionDay,
      StartDate: params.startDate,
    },
  );
}

/** DebiCheck -- mandate authentication + recurring collection instruction. */
export async function submitDebiCheckMandate(connection: { config: unknown }, params: {
  reference: string;
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  idNumber: string;
  mobileNumber: string;
  collectionAmount: number;
  collectionDay: number;
  maxCollectionAmount: number;
  frequency: "MONTHLY";
  startDate: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ mandateReference: string; status: string; raw: unknown }>(
    "/inbound-payments/dc/mandate",
    {
      ServiceKey: cfg.debiCheckServiceKey,
      Reference: params.reference,
      AccountHolderName: params.accountHolderName,
      BankAccountNumber: params.bankAccountNumber,
      BranchCode: params.branchCode,
      IdNumber: params.idNumber,
      MobileNumber: params.mobileNumber,
      CollectionAmount: params.collectionAmount,
      MaxCollectionAmount: params.maxCollectionAmount,
      CollectionDay: params.collectionDay,
      Frequency: params.frequency,
      StartDate: params.startDate,
    },
  );
}

/** DebiCheck -- submit a collection against an already-authenticated mandate. */
export async function submitDebiCheckCollection(connection: { config: unknown }, params: {
  mandateReference: string;
  amount: number;
  actionDate: string;
  reference: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ collectionReference: string; status: string; raw: unknown }>(
    "/inbound-payments/dc/collection",
    {
      ServiceKey: cfg.debiCheckServiceKey,
      MandateReference: params.mandateReference,
      Amount: params.amount,
      ActionDate: params.actionDate,
      Reference: params.reference,
    },
  );
}

/** Standard (NAEDO/EFT) debit order -- for facilities/customers not on DebiCheck. */
export async function submitStandardDebitOrder(connection: { config: unknown }, params: {
  reference: string;
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  accountType: "CURRENT" | "SAVINGS" | "TRANSMISSION";
  amount: number;
  actionDate: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ batchReference: string; status: string; raw: unknown }>(
    "/inbound-payments/debit-orders/submit",
    {
      ServiceKey: cfg.debitOrderServiceKey,
      Reference: params.reference,
      AccountHolderName: params.accountHolderName,
      BankAccountNumber: params.bankAccountNumber,
      BranchCode: params.branchCode,
      AccountType: params.accountType,
      Amount: params.amount,
      ActionDate: params.actionDate,
    },
  );
}

export const NETCASH_PAY_NOW_ACTION_URL = "https://paynow.netcash.co.za/site/paynow.aspx";

/**
 * Pay Now eCommerce -- builds the hidden-field set for a browser form POST to
 * NETCASH_PAY_NOW_ACTION_URL. This does NOT call Netcash from the server:
 * Netcash's docs are explicit that the form must be submitted by the
 * customer's own browser with target="_top" (never inside an iframe), so the
 * caller renders these fields into an auto-submitting <form> and lets the
 * browser navigate there.
 *
 * ReturnUrl/CancelUrl/NotifyUrl are deliberately NOT fields here -- eCommerce
 * doesn't accept them per-request. Before this can be used for a real test
 * transaction, log into the Netcash merchant portal, open the Pay Now
 * service key's NetConnector Profile, and set:
 *   - Notify URL   -> {appBaseUrl}/api/webhooks/netcash
 *   - Accept URL   -> {appBaseUrl}/payments/{paymentId}/return  (or a fixed
 *                      generic accept page if Netcash won't accept a
 *                      per-transaction URL here either -- check the portal)
 *   - Decline URL  -> {appBaseUrl}/payments/{paymentId}/cancel
 * "If you're developing on behalf of a Netcash client, supply the client
 * with the postback URLs they need to insert in your NetConnector profile"
 * -- direct from Netcash's docs, i.e. this really is a one-time manual step
 * in their dashboard, not something this codebase can configure.
 */
export function createPayNowCheckout(connection: { config: unknown }, params: {
  reference: string; // becomes p2 -- max 25 chars, single-use per Netcash's docs
  amount: number; // ZAR
  description: string; // becomes p3 -- max 50 chars
  customerEmail?: string;
  extra1?: string; // returned verbatim on the Notify postback as Extra1
  extra2?: string;
  extra3?: string;
}): { actionUrl: string; method: "POST"; fields: Record<string, string> } {
  const cfg = config(connection);
  if (!cfg.payNowServiceKey) throw new Error("NETCASH_PAY_NOW_SERVICE_KEY_MISSING");
  if (params.reference.length > 25) throw new Error(`NETCASH_PAY_NOW_REFERENCE_TOO_LONG: ${params.reference.length} chars, max 25`);
  if (params.description.length > 50) throw new Error(`NETCASH_PAY_NOW_DESCRIPTION_TOO_LONG: ${params.description.length} chars, max 50`);
  if (!(params.amount > 0)) throw new Error("NETCASH_PAY_NOW_AMOUNT_MUST_BE_POSITIVE");
  const fields: Record<string, string> = {
    m1: cfg.payNowServiceKey,
    m2: NETCASH_SOFTWARE_VENDOR_KEY,
    p2: params.reference,
    p3: params.description,
    p4: params.amount.toFixed(2),
    Budget: "Y",
  };
  if (params.customerEmail) fields.m9 = params.customerEmail;
  if (params.extra1) fields.m4 = params.extra1;
  if (params.extra2) fields.m5 = params.extra2;
  if (params.extra3) fields.m6 = params.extra3;
  return { actionUrl: NETCASH_PAY_NOW_ACTION_URL, method: "POST", fields };
}

/**
 * Server-to-server re-verification of a Pay Now transaction by RequestTrace.
 * Netcash's eCommerce Notify postback has no documented signature/hash, so
 * it must be treated as a hint, not proof -- the webhook handler calls this
 * with the RequestTrace from the postback and only mutates Payment/
 * LedgerEntry state based on THIS response, never the raw postback body.
 * No service key or auth header is documented for this endpoint -- it's
 * scoped by the (effectively unguessable) RequestTrace value alone.
 */
export async function checkPayNowTransactionStatus(requestTrace: string, request: typeof fetch = fetch) {
  const res = await request(`https://ws.netcash.co.za/PayNow/TransactionStatus/Check?RequestTrace=${encodeURIComponent(requestTrace)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`NETCASH_TRANSACTION_STATUS_HTTP_${res.status}: ${text.slice(0, 500)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`NETCASH_TRANSACTION_STATUS_NON_JSON: ${text.slice(0, 500)}`);
  }
  const body = parsed as { RequestTrace?: string; Amount?: string; TransactionAccepted?: boolean; Reference?: string; Reason?: string };
  return {
    requestTrace: body.RequestTrace ?? requestTrace,
    amount: body.Amount,
    accepted: body.TransactionAccepted === true,
    reference: body.Reference,
    reason: body.Reason,
    raw: body,
  };
}

/** Account Verification Service -- confirm a bank account is valid/open before setting up a mandate. */
export async function verifyBankAccount(connection: { config: unknown }, params: {
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  idNumber?: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ verified: boolean; accountStatus: string; raw: unknown }>(
    "/value-added-services/avs/verify",
    {
      ServiceKey: cfg.avsServiceKey,
      AccountHolderName: params.accountHolderName,
      BankAccountNumber: params.bankAccountNumber,
      BranchCode: params.branchCode,
      IdNumber: params.idNumber,
    },
  );
}

/** Netcash account statement -- used for reconciliation against what we expect to have been collected. */
export async function fetchNetcashStatement(connection: { config: unknown }, params: {
  fromDate: string;
  toDate: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ lines: unknown[]; raw: unknown }>(
    "/standard-integration/netcash-statement/query",
    {
      ServiceKey: cfg.statementServiceKey,
      FromDate: params.fromDate,
      ToDate: params.toDate,
    },
  );
}
