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
 * IMPORTANT -- NOT YET VERIFIED LIVE.
 * The endpoint paths, field names and payload shapes below are a best-effort
 * scaffold built from Netcash's public developer docs (api.netcash.co.za) as
 * captured during this session -- full page content could not be fully read
 * in this environment (docs pages exceeded fetch limits). Before this goes
 * anywhere near real money:
 *   1. Get a Netcash sandbox account and real service keys.
 *   2. Confirm every endpoint path and field name against Netcash's current
 *      docs (they use different key names per product -- ServiceKey,
 *      VendorKey, SoftwareVendorKey turn up in different products).
 *   3. Confirm the notify/webhook callback contract (signature/hash
 *      verification is stubbed in src/app/api/webhooks/netcash/route.ts and
 *      MUST be replaced with Netcash's actual verification scheme).
 *   4. Run a real transaction in Netcash's sandbox end to end before
 *      enabling this for a facility.
 */
import { db } from "@/lib/db";

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

/** Pay Now -- hosted/redirect once-off payment (card, EFT, etc). Returns a URL to redirect the customer to. */
export async function createPayNowCheckout(connection: { config: unknown }, params: {
  reference: string;
  amount: number;
  description: string;
  customerEmail?: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}) {
  const cfg = config(connection);
  return netcashRequest<{ redirectUrl: string; reference: string; raw: unknown }>(
    "/inbound-payments/pay-now/checkout",
    {
      ServiceKey: cfg.payNowServiceKey,
      Reference: params.reference,
      Amount: params.amount,
      Description: params.description,
      Email: params.customerEmail,
      ReturnUrl: params.returnUrl,
      CancelUrl: params.cancelUrl,
      NotifyUrl: params.notifyUrl,
    },
  );
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
