/**
 * Reads the org/facility-level details a billing document needs for its
 * header/footer (company name, address, registration & VAT numbers,
 * banking details) from `ConfigurationProfile` — the same model and the
 * same lookup shape already used for BlendSign lease documents in
 * src/lib/blendsign-lease-service.ts (`domain: "STORE_INFORMATION"`,
 * `name: "Default"`, `status: "READY"`), not a new model. `BANKING_ACCOUNTING`
 * is a second, separate domain already defined in the configurationSchema
 * enum (src/lib/validators.ts) — presumed to hold banking details, but
 * nothing in this codebase populates or reads it yet, so this file is
 * deliberately defensive: every field is optional, and an empty/missing
 * profile renders a document with no footer banking block rather than
 * throwing. Confirm the actual config shape (key names inside `config`)
 * against whatever's entered once someone populates these profiles for
 * real — the field names read below (companyName, registrationNumber,
 * vatNumber, address, bank/accountName/accountNumber/branchCode/swift) are
 * a reasonable guess at a shape, not a verified contract.
 */
import { db } from "@/lib/db";

export type BillingDocumentCompanyDetails = {
  companyName?: string;
  registrationNumber?: string;
  vatNumber?: string;
  addressLines?: string[];
  banking?: {
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    branchCode?: string;
    swift?: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return lines.length ? lines : undefined;
}

export async function getBillingDocumentCompanyDetails(organisationId: string, facilityId: string | null): Promise<BillingDocumentCompanyDetails> {
  const [storeInfo, banking] = await Promise.all([
    db.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: "STORE_INFORMATION", name: "Default", status: "READY" }, select: { config: true } }),
    db.configurationProfile.findFirst({ where: { organisationId, facilityId, domain: "BANKING_ACCOUNTING", name: "Default", status: "READY" }, select: { config: true } }),
  ]);
  const store = asRecord(storeInfo?.config);
  const bank = asRecord(banking?.config);
  const bankDetails = asRecord(bank.banking ?? bank);

  return {
    companyName: asString(store.companyName) ?? asString(store.name),
    registrationNumber: asString(store.registrationNumber),
    vatNumber: asString(store.vatNumber),
    addressLines: asStringArray(store.addressLines) ?? asStringArray(store.address),
    banking: {
      bankName: asString(bankDetails.bankName),
      accountName: asString(bankDetails.accountName),
      accountNumber: asString(bankDetails.accountNumber),
      branchCode: asString(bankDetails.branchCode),
      swift: asString(bankDetails.swift),
    },
  };
}
