type PaymentMethod = "DEBIT_ORDER" | "CARD" | "EFT" | "OTHER";

type LeaseEnvelopeInput = {
  documentId: string;
  tenancyId: string;
  paymentMethod: PaymentMethod;
  customer: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    identityRef: string | null;
    taxNumber: string | null;
    billingAddress: unknown;
  };
  facility: { name: string };
  ownerDetails?: Record<string, unknown>;
  unit: { number: string; unitType: { name: string; widthMetres: unknown; lengthMetres: unknown; areaSqMetres: unknown } };
  startDate: Date;
  monthlyRate: number;
  representative: { name: string; email: string };
  autoCountersign?: boolean;
  simulation?: boolean;
};

export type BlendSignEnvelope = {
  envelopeId: string;
  status: string;
  idempotent: boolean;
  signers: Array<{ id: string; name: string; email: string | null; order: number; signingUrl: string }>;
};

export type BlendSignArtifact = "signed" | "certificate";

export async function fetchBlendSignArtifact(envelopeId: string, artifact: BlendSignArtifact) {
  const baseUrl = process.env.BLENDSIGN_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.BLENDSIGN_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("BLENDSIGN_CONFIG_REQUIRED");
  const path = artifact === "signed"
    ? `/api/envelopes/${encodeURIComponent(envelopeId)}/document?version=signed&download=1`
    : `/api/envelopes/${encodeURIComponent(envelopeId)}/certificate`;
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

export async function resendBlendSignInvitation(envelopeId: string, requestId: string) {
  const baseUrl = process.env.BLENDSIGN_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.BLENDSIGN_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("BLENDSIGN_CONFIG_REQUIRED");
  return fetch(`${baseUrl}/api/v1/envelopes/${encodeURIComponent(envelopeId)}/resend`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "idempotency-key": requestId },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

export function blendSignTemplateKey(paymentMethod: PaymentMethod) {
  return paymentMethod === "DEBIT_ORDER" ? "stor24-unit-lease-debit-order" : "stor24-unit-lease";
}

function addressRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function unitSize(unitType: LeaseEnvelopeInput["unit"]["unitType"]) {
  if (unitType.areaSqMetres !== null && unitType.areaSqMetres !== undefined) return `${Number(unitType.areaSqMetres).toFixed(1)} m2`;
  if (unitType.widthMetres !== null && unitType.lengthMetres !== null && unitType.widthMetres !== undefined && unitType.lengthMetres !== undefined) return `${Number(unitType.widthMetres).toFixed(1)} x ${Number(unitType.lengthMetres).toFixed(1)} m`;
  return unitType.name;
}

export async function createBlendSignLeaseEnvelope(input: LeaseEnvelopeInput): Promise<BlendSignEnvelope> {
  const baseUrl = process.env.BLENDSIGN_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.BLENDSIGN_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("BLENDSIGN_CONFIG_REQUIRED");
  if (!input.customer.email) throw new Error("CUSTOMER_EMAIL_REQUIRED");

  const name = input.customer.companyName || [input.customer.firstName, input.customer.lastName].filter(Boolean).join(" ") || "Customer";
  const address = addressRecord(input.customer.billingAddress);
  const owner = addressRecord(input.ownerDetails);
  const data: Record<string, string> = {
    "tenant.fullName": name,
    "tenant.email": input.customer.email,
    "facility.name": input.facility.name,
    "unit.number": input.unit.number,
    "unit.size": unitSize(input.unit.unitType),
    "lease.startDate": input.startDate.toISOString().slice(0, 10),
    "lease.monthlyRental": input.monthlyRate.toFixed(2),
    "lease.deposit": input.monthlyRate.toFixed(2),
  };
  data["owner.companyName"] = owner.legalName || owner.dbaName || input.facility.name;
  if (owner.registrationNumber) data["owner.registrationNumber"] = owner.registrationNumber;
  if (owner.address1) data["owner.address"] = [owner.address1, owner.address2].filter(Boolean).join(", ");
  if (owner.city) data["owner.city"] = owner.city;
  if (owner.postalCode) data["owner.postalCode"] = owner.postalCode;
  if (owner.phone) data["owner.mobile"] = owner.phone;
  if (owner.taxNumber) data["owner.vatNumber"] = owner.taxNumber;
  if (owner.email) data["owner.email"] = owner.email;
  if (input.customer.identityRef) data["tenant.idNumber"] = input.customer.identityRef;
  if (input.customer.phone) {
    data["tenant.phone"] = input.customer.phone;
  }
  if (input.customer.taxNumber) data["tenant.vatNumber"] = input.customer.taxNumber;
  if (address.address || address.street || address.line1) data["tenant.address"] = address.address || address.street || address.line1;
  if (address.city) data["tenant.city"] = address.city;
  if (address.postalCode || address.postcode) data["tenant.postalCode"] = address.postalCode || address.postcode;
  data["stor24.representativeName"] = input.representative.name;
  if (input.paymentMethod === "DEBIT_ORDER") {
    data["payment.debitOrder"] = "true";
    data["debit.commencementDate"] = input.startDate.toISOString().slice(0, 10);
    data["debit.amount"] = input.monthlyRate.toFixed(2);
    data["tenant.contactPerson"] = [input.customer.firstName, input.customer.lastName].filter(Boolean).join(" ") || name;
  }
  else if (input.paymentMethod === "CARD") data["payment.creditCard"] = "true";
  else data["payment.eftOther"] = "true";

  const response = await fetch(`${baseUrl}/api/v1/envelopes/from-template`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `stor24-lease:${input.tenancyId}`,
    },
    body: JSON.stringify({
      templateKey: blendSignTemplateKey(input.paymentMethod),
      externalReference: input.tenancyId,
      title: `${input.simulation ? "UAT TEST - " : ""}Stor24 lease - unit ${input.unit.number}`,
      data,
      recipients: [
        { role: "Signer 1", name, email: input.customer.email },
        { role: "Stor24 Rep", name: input.representative.name, email: input.representative.email, autoSign: Boolean(input.autoCountersign) },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as BlendSignEnvelope & { error?: unknown };
  if (!response.ok) throw new Error(`BLENDSIGN_CREATE_FAILED:${response.status}:${JSON.stringify(payload.error ?? payload)}`);
  return payload;
}
