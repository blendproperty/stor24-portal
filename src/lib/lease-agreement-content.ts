// STOR 24 storage licence agreement — clause content.
//
// STATUS: DRAFT. This is placeholder legal boilerplate, not attorney-reviewed contract
// language. Brett (or STOR 24's attorney) must review and approve the actual wording
// before this is relied on as a binding agreement for real tenants. Bump LEASE_VERSION
// whenever clause wording changes materially, so historically signed documents remain
// tied to the exact version of the text the signer actually saw and initialled.

export const LEASE_VERSION = "v1-draft-2026-08-18";

export type LeaseClauseKey =
  | "premises_and_use"
  | "term_and_rent"
  | "access_and_security"
  | "insurance_and_liability"
  | "prohibited_items"
  | "default_and_termination"
  | "data_and_privacy";

export type LeaseClauseContext = {
  facilityName: string;
  unitNumber: string;
  unitTypeName?: string;
  customerName: string;
  monthlyRate: number;
  startDate: Date;
};

type ClauseDefinition = { key: LeaseClauseKey; title: string; body: (ctx: LeaseClauseContext) => string };

function formatRate(amount: number) {
  return `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
}
function formatDate(date: Date) {
  return date.toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Johannesburg" });
}

const CLAUSE_DEFINITIONS: ClauseDefinition[] = [
  {
    key: "premises_and_use",
    title: "1. Premises and permitted use",
    body: (ctx) => `STOR 24 ("the Licensor") grants ${ctx.customerName} ("the Licensee") a non-exclusive licence to use storage unit ${ctx.unitNumber}${ctx.unitTypeName ? ` (${ctx.unitTypeName})` : ""} at ${ctx.facilityName} ("the Premises") solely for the storage of lawful, permitted goods. The Licensee may not use the Premises for residential occupation, for carrying on a business from the unit, or for any unlawful purpose.`,
  },
  {
    key: "term_and_rent",
    title: "2. Term and rent",
    body: (ctx) => `This licence commences on ${formatDate(ctx.startDate)} and continues on a month-to-month basis until terminated in accordance with clause 6. The monthly licence fee is ${formatRate(ctx.monthlyRate)}, excluding applicable tax, payable monthly in advance. Fees are subject to change on reasonable prior written notice.`,
  },
  {
    key: "access_and_security",
    title: "3. Access and security",
    body: () => `The Licensee will be issued with access credentials (code, card, biometric enrolment or equivalent) to the facility during posted access hours. Access credentials are personal to the Licensee and may not be shared. The Licensor may suspend access for non-payment or breach of this agreement, subject to any notice required by law. The Licensor maintains reasonable facility security but is not an insurer of the Licensee's goods.`,
  },
  {
    key: "insurance_and_liability",
    title: "4. Insurance and liability",
    body: () => `The Licensee is solely responsible for insuring the goods stored in the unit. The Licensor accepts no liability for loss or damage to stored goods except to the extent caused by the Licensor's gross negligence or wilful misconduct. The Licensee indemnifies the Licensor against claims arising from the Licensee's use of the Premises, to the extent permitted by law.`,
  },
  {
    key: "prohibited_items",
    title: "5. Prohibited items",
    body: () => `The Licensee may not store flammable, explosive, hazardous, illegal, perishable, or living items, or any goods that create a health, safety or environmental risk. The Licensor may inspect a unit on reasonable notice, or without notice where there is a genuine safety concern, and may remove prohibited items at the Licensee's cost.`,
  },
  {
    key: "default_and_termination",
    title: "6. Default and termination",
    body: () => `Either party may terminate this licence on notice as set out in the Licensor's standard terms. The Licensor may terminate immediately, and may exercise a lien over stored goods to the extent permitted by law, if the Licensee is in material breach, including non-payment of fees. On termination the Licensee must remove all goods and vacate the unit by the agreed move-out date.`,
  },
  {
    key: "data_and_privacy",
    title: "7. Data and privacy",
    body: () => `The Licensor will process the Licensee's personal information (including, where applicable, biometric access data) in accordance with the Protection of Personal Information Act and the Licensor's privacy notice, solely for the purposes of operating this agreement and the facility.`,
  },
];

export const LEASE_CLAUSE_KEYS = CLAUSE_DEFINITIONS.map((clause) => clause.key) as LeaseClauseKey[];

export function buildLeaseClauses(ctx: LeaseClauseContext) {
  return CLAUSE_DEFINITIONS.map((clause) => ({ key: clause.key, title: clause.title, body: clause.body(ctx) }));
}

export function renderLeaseDocument(ctx: LeaseClauseContext) {
  const clauses = buildLeaseClauses(ctx);
  return [
    "STOR 24 SELF-STORAGE LICENCE AGREEMENT",
    `Version: ${LEASE_VERSION}`,
    "",
    `Facility: ${ctx.facilityName}`,
    `Unit: ${ctx.unitNumber}${ctx.unitTypeName ? ` (${ctx.unitTypeName})` : ""}`,
    `Licensee: ${ctx.customerName}`,
    `Monthly rate: ${formatRate(ctx.monthlyRate)} (excl. applicable tax)`,
    `Commencement date: ${formatDate(ctx.startDate)}`,
    "",
    ...clauses.flatMap((clause) => [clause.title, clause.body, ""]),
    "By initialling each clause above and signing below, the Licensee confirms they have read, understood and agree to be bound by each clause of this agreement.",
  ].join("\n");
}
