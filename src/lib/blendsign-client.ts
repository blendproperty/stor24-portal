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
    alternateContact: unknown;
    emergencyContact: unknown;
    workContact: unknown;
  };
  facility: { name: string; storeInformation?: unknown };
  unit: { number: string; unitType: { name: string; widthMetres: unknown; lengthMetres: unknown; areaSqMetres: unknown } };
  startDate: Date;
  monthlyRate: number;
  representative: { name: string; email: string };
};

export type BlendSignEnvelope = {
  envelopeId: string;
  status: string;
  idempotent: boolean;
  signers: Array<{ id: string; name: string; email: string | null; order: number; signingUrl: string }>;
};

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
  const alternate = addressRecord(input.customer.alternateContact);
  const emergency = addressRecord(input.customer.emergencyContact);
  const work = addressRecord(input.customer.workContact);
  const owner = addressRecord(input.facility.storeInformation);
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
  if (input.customer.identityRef) data["tenant.idNumber"] = input.customer.identityRef;
  if (input.customer.phone) {
    data["tenant.phone"] = input.customer.phone;
    data["tenant.telephone"] = input.customer.phone;
  }
  if (input.customer.taxNumber) data["tenant.vatNumber"] = input.customer.taxNumber;
  if (address.address || address.street || address.line1) data["tenant.address"] = address.address || address.street || address.line1;
  if (address.city) data["tenant.city"] = address.city;
  if (address.postalCode || address.postcode) data["tenant.postalCode"] = address.postalCode || address.postcode;
  if (work.company) data["tenant.employerName"] = work.company;
  if (work.address) data["tenant.employerAddress"] = work.address;
  const employerContact = [work.contact, work.phone, work.email].filter(Boolean).join(" | ");
  if (employerContact) data["tenant.employerContactDetails"] = employerContact;
  if (alternate.name) data["tenant.alternativeContact1.name"] = alternate.name;
  if (alternate.phone) data["tenant.alternativeContact1.phone"] = alternate.phone;
  if (alternate.relationship) data["tenant.alternativeContact1.relationship"] = alternate.relationship;
  if (emergency.name) data["tenant.alternativeContact2.name"] = emergency.name;
  if (emergency.phone) data["tenant.alternativeContact2.phone"] = emergency.phone;
  if (emergency.relationship) data["tenant.alternativeContact2.relationship"] = emergency.relationship;
  if (owner.legalName || owner.dbaName) data["owner.companyName"] = owner.legalName || owner.dbaName;
  if (owner.registrationNumber) data["owner.registrationNumber"] = owner.registrationNumber;
  if (owner.address1) data["owner.address"] = [owner.address1, owner.address2].filter(Boolean).join(", ");
  if (owner.city) data["owner.city"] = owner.city;
  if (owner.postalCode) data["owner.postalCode"] = owner.postalCode;
  if (owner.taxNumber) data["owner.vatNumber"] = owner.taxNumber;
  if (owner.mobile || owner.phone) data["owner.mobile"] = owner.mobile || owner.phone;
  if (owner.email) data["owner.email"] = owner.email;
  data["stor24.representativeName"] = input.representative.name;
  if (input.paymentMethod === "DEBIT_ORDER") {
    data["payment.debitOrder"] = "true";
    data["billing.contactEmail"] = input.customer.email;
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
      title: `Stor24 lease - unit ${input.unit.number}`,
      data,
      recipients: [
        { role: "Signer 1", name, email: input.customer.email },
        { role: "Stor24 Rep", name: input.representative.name, email: input.representative.email },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as BlendSignEnvelope & { error?: unknown };
  if (!response.ok) throw new Error(`BLENDSIGN_CREATE_FAILED:${response.status}:${JSON.stringify(payload.error ?? payload)}`);
  return payload;
}
