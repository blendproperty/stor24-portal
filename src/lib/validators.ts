import { z } from "zod";
import { LEASE_CLAUSE_KEYS } from "@/lib/lease-agreement-content";

export const createLeadSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email(),
  phone: z.string().trim().min(7).max(30),
  facilityId: z.string().trim().min(1),
  desiredUnitTypeId: z.string().trim().optional(),
  source: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const offlineLeadSyncSchema = z.object({
  submissionId: z.string().uuid(),
  deviceId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]{16,64}$/),
  capturedAt: z.iso.datetime(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().optional(),
  phone: z.string().trim().min(7).max(30),
  facilityId: z.string().trim().min(1).max(64),
  desiredUnitTypeId: z.string().trim().min(1).max(64).optional(),
  expectedMoveIn: z.iso.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  consentToContact: z.literal(true),
  communicationConsent: z
    .object({
      email: z.boolean().default(false),
      sms: z.boolean().default(false),
      whatsapp: z.boolean().default(false),
    })
    .default({ email: false, sms: false, whatsapp: false }),
});

export type OfflineLeadSyncInput = z.infer<typeof offlineLeadSyncSchema>;

export const offlineReservationSyncSchema = z.object({
  submissionId: z.string().uuid(),
  leadSubmissionId: z.string().uuid(),
  deviceId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]{16,64}$/),
  capturedAt: z.iso.datetime(),
  facilityId: z.string().trim().min(1).max(64),
  customerId: z.string().trim().min(1).max(64),
  leadId: z.string().trim().min(1).max(64),
  unitId: z.string().trim().min(1).max(64),
  quotedRate: z.coerce.number().positive().max(10_000_000),
  intendedMoveIn: z.iso.date().optional(),
  paymentMethod: z.enum(["DEBIT_ORDER", "CARD", "EFT", "UNDECIDED"]),
});

export type OfflineReservationSyncInput = z.infer<
  typeof offlineReservationSyncSchema
>;

const id = z.string().trim().min(1).max(64);
const money = z.coerce.number().nonnegative().max(10_000_000);
const optionalText = z.string().trim().max(2000).optional();

export const facilitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(40).toUpperCase(),
  timezone: z.string().trim().min(3).max(80).default("Africa/Johannesburg"),
  address: z.record(z.string(), z.string()).optional(),
  active: z.boolean().default(true),
  publicSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100)
    .nullable()
    .optional(),
  publicBookingEnabled: z.boolean().default(false),
});
export const unitTypeSchema = z.object({
  facilityId: id,
  name: z.string().trim().min(1).max(100),
  widthMetres: z.coerce.number().positive().optional(),
  lengthMetres: z.coerce.number().positive().optional(),
  areaSqMetres: z.coerce.number().positive().optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});
export const unitSchema = z.object({
  facilityId: id,
  unitTypeId: id,
  number: z.string().trim().min(1).max(40),
  floor: z.string().trim().max(40).optional(),
  zone: z.string().trim().max(40).optional(),
  monthlyRate: money,
  taxRate: z.coerce.number().min(0).max(1).default(0.15),
  status: z
    .enum([
      "AVAILABLE",
      "HELD",
      "RESERVED",
      "OCCUPIED",
      "SERVICE",
      "UNAVAILABLE",
    ])
    .default("AVAILABLE"),
});
const contactRecord = z.record(z.string(), z.string().max(300)).optional();
export const customerSchema = z
  .object({
    type: z.enum(["INDIVIDUAL", "BUSINESS"]).default("INDIVIDUAL"),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    companyName: z.string().trim().max(160).optional(),
    email: z.email().optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    identityRef: z.string().trim().max(100).optional(),
    taxNumber: z.string().trim().max(100).optional(),
    dateOfBirth: z.coerce.date().optional(),
    billingAddress: contactRecord,
    emergencyContact: contactRecord,
    alternateContact: contactRecord,
    workContact: contactRecord,
    communicationConsent: z
      .object({
        email: z.boolean().default(false),
        sms: z.boolean().default(false),
        phone: z.boolean().default(false),
        whatsapp: z.boolean().default(false),
        recordedAt: z.string().datetime().optional(),
        source: z.string().trim().max(80).optional(),
      })
      .optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .refine(
    (v) => v.companyName || (v.firstName && v.lastName),
    "Provide a person or company name.",
  );
export const leadSchema = z.object({
  facilityId: id,
  customerId: id.optional(),
  desiredUnitTypeId: id.optional(),
  stage: z
    .enum([
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "QUOTED",
      "VIEWING_BOOKED",
      "RESERVED",
      "WON",
      "LOST",
    ])
    .default("NEW"),
  source: z.string().trim().min(1).max(80),
  notes: optionalText,
  expectedMoveIn: z.coerce.date().optional(),
  nextActionAt: z.coerce.date().optional(),
  assignedToId: id.optional(),
});
export const reservationSchema = z.object({
  facilityId: id,
  customerId: id,
  leadId: id.optional(),
  unitId: id,
  quotedRate: money,
  holdExpiresAt: z.coerce.date().optional(),
  intendedMoveIn: z.coerce.date().optional(),
});
export const reservationLifecycleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("EXTEND"),
    reservationId: id,
    holdExpiresAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("EXPIRE"),
    reservationId: id,
    reason: z.string().trim().min(3).max(500),
  }),
]);
export const moveInSchema = z.object({
  reservationId: id.optional(),
  facilityId: id,
  customerId: id,
  unitId: id,
  startDate: z.coerce.date(),
  monthlyRate: money.optional(),
  initialCharge: money.default(0),
  accessState: z.string().trim().min(1).max(40).default("PENDING"),
  paymentMethod: z.enum(["DEBIT_ORDER", "CARD", "EFT", "OTHER"]),
});
export const leaseSignatureSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  initials: z
    .array(z.enum(LEASE_CLAUSE_KEYS))
    .refine(
      (value) => LEASE_CLAUSE_KEYS.every((key) => value.includes(key)),
      "Every clause of the lease agreement must be initialled.",
    ),
});
export const transferSchema = z.object({
  tenancyId: id,
  toUnitId: id,
  effectiveAt: z.coerce.date(),
  monthlyRate: money.optional(),
});
export const noticeSchema = z
  .object({
    tenancyId: id,
    noticeDate: z.coerce.date(),
    plannedMoveOut: z.coerce.date(),
  })
  .refine(
    (v) => v.plannedMoveOut >= v.noticeDate,
    "Move-out cannot precede notice.",
  );
export const moveOutSchema = z.object({
  tenancyId: id,
  movedOutAt: z.coerce.date(),
  finalCharge: money.default(0),
  notes: optionalText,
});
export const accountPaymentSchema = z.object({
  accountId: id,
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.enum(["CASH", "EFT", "CARD", "BANK_DEBIT"]),
  reference: z.string().trim().max(120).optional(),
  receivedAt: z.coerce.date(),
});

export const createInvitationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.toLowerCase()),
  roleName: z.enum([
    "Organisation owner",
    "Facility manager",
    "Sales / leasing",
    "Collections",
    "Finance",
    "Auditor / read only",
  ]),
  facilityCode: z.string().trim().max(40).optional(),
});

const strongPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.")
  .regex(/[^a-zA-Z0-9]/, "Add a special character.");

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(200),
  password: strongPasswordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const ownerSetupSchema = loginSchema.extend({
  token: z.string().min(32).max(200),
  name: z.string().trim().min(2).max(120),
  password: strongPasswordSchema,
});

export const createTaskSchema = z.object({
  facilityId: z.string().cuid().optional(),
  customerId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueAt: z.iso.datetime().optional(),
});

export const updateTaskSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"]),
});

export const unitNoteSchema = z.object({
  facilityId: z.string().cuid(),
  unitId: z.string().cuid(),
  note: z.string().trim().min(2).max(4000),
  pinned: z.boolean().default(false),
});

export const maintenanceSchema = z.object({
  facilityId: z.string().cuid(),
  unitId: z.string().cuid().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueAt: z.iso.datetime().optional(),
});

export const productSchema = z.object({
  facilityId: z.string().cuid(),
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(100).optional(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  quantityOnHand: z.number().int().nonnegative().default(0),
  reorderPoint: z.number().int().nonnegative().default(0),
});

export const stockMovementSchema = z.object({
  productId: z.string().cuid(),
  type: z.enum([
    "RECEIPT",
    "SALE",
    "RETURN",
    "ADJUSTMENT",
    "DAMAGE",
    "TRANSFER",
  ]),
  quantity: z
    .number()
    .int()
    .refine((value) => value !== 0, "Quantity cannot be zero."),
  unitCost: z.number().nonnegative().optional(),
  reason: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(100).optional(),
});

export const dailyCloseSchema = z.object({
  facilityId: z.string().cuid(),
  businessDate: z.iso.date(),
  expectedCash: z.number().nonnegative(),
  countedCash: z.number().nonnegative(),
  notes: z.string().trim().max(2000).optional(),
  checks: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        label: z.string().min(1).max(160),
        complete: z.boolean(),
      }),
    )
    .min(1),
});

export const configurationSchema = z.object({
  facilityId: z.string().cuid().nullable().optional(),
  domain: z.enum([
    "FACILITY",
    "STORE_INFORMATION",
    "WEBSITE_ATTRIBUTES",
    "PROGRAM_DEFAULTS",
    "TENANT_DEFAULTS",
    "BANKING_ACCOUNTING",
    "MARKETING",
    "PRICE_OPTIMIZER",
    "FACILITY_MAP",
    "PHONE",
    "MARKETPLACE",
  ]),
  name: z.string().trim().min(1).max(120),
  status: z.enum(["DRAFT", "READY", "DISABLED"]).default("DRAFT"),
  config: z.record(z.string(), z.json()),
});

export const integrationSchema = z.object({
  facilityId: z.string().cuid().nullable().optional(),
  category: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(100),
  status: z
    .enum(["DISCONNECTED", "CONFIGURED", "DISABLED"])
    .default("DISCONNECTED"),
  config: z
    .object({
      endpoint: z.url().optional(),
      accountReference: z.string().max(120).optional(),
      notes: z.string().max(500).optional(),
    })
    .strict(),
});

export const chargeDefinitionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  amount: z.number().nonnegative().optional(),
  calculation: z.enum(["FIXED", "PERCENTAGE", "RULE_BASED"]).default("FIXED"),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
  config: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});

export const discountPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  discountType: z.enum(["FIXED", "PERCENTAGE"]),
  value: z.number().nonnegative(),
  active: z.boolean().default(true),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  rules: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

export const insurancePlanSchema = z.object({
  facilityId: z.string().cuid().nullable().optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  providerName: z.string().trim().max(120).optional(),
  coverageAmount: z.number().positive(),
  monthlyPremium: z.number().nonnegative(),
  excessAmount: z.number().nonnegative().default(0),
  policyVersion: z.string().trim().max(80).optional(),
  termsUrl: z.url().optional(),
});

export const insuranceDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    tenancyId: z.string().cuid(),
    decision: z.literal("ENROL"),
    planId: z.string().cuid(),
    effectiveFrom: z.iso.date(),
  }),
  z.object({
    tenancyId: z.string().cuid(),
    decision: z.literal("WAIVE"),
    waiverReason: z.string().trim().min(3).max(500),
  }),
  z.object({ tenancyId: z.string().cuid(), decision: z.literal("CANCEL") }),
]);

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200),
  password: strongPasswordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  password: strongPasswordSchema,
});
export const updateUserSchema = z
  .object({
    active: z.boolean().optional(),
    roleName: createInvitationSchema.shape.roleName.optional(),
    facilityCode: z.string().trim().max(40).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
