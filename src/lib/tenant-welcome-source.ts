import type { Prisma } from "@/generated/prisma/client";

export type TenantWelcomeSource = { kind: "RESERVATION" | "ACCOUNT" | "TENANCY"; id: string; facilityId: string };

/** Resolve only the supplied event/account, never a customer's first store. */
export async function tenantWelcomeFacility(tx: Prisma.TransactionClient, organisationId: string, customerId: string, source: TenantWelcomeSource): Promise<string> {
  if (!source?.id || !source.facilityId) throw new Error("WELCOME_SOURCE_REVIEW");
  if (source.kind === "RESERVATION") {
    const row = await tx.reservation.findFirst({ where: { id: source.id, customerId, customer: { organisationId }, facility: { organisationId } }, select: { facilityId: true } });
    if (row?.facilityId === source.facilityId) return row.facilityId;
  } else if (source.kind === "TENANCY") {
    const row = await tx.tenancy.findFirst({ where: { id: source.id, customerId, customer: { organisationId }, facility: { organisationId } }, select: { facilityId: true } });
    if (row?.facilityId === source.facilityId) return row.facilityId;
  } else if (source.kind === "ACCOUNT") {
    const row = await tx.account.findFirst({ where: { id: source.id, customerId, customer: { organisationId } }, select: { accountNumber: true, tenancy: { select: { customerId: true, facilityId: true, facility: { select: { organisationId: true } } } } } });
    if (row?.tenancy && row.tenancy.customerId === customerId && row.tenancy.facility.organisationId === organisationId && row.tenancy.facilityId === source.facilityId) return row.tenancy.facilityId;
    if (row && !row.tenancy && row.accountNumber.startsWith("ST24-T-")) return tenantWelcomeFacility(tx, organisationId, customerId, { kind: "RESERVATION", id: row.accountNumber.slice(7), facilityId: source.facilityId });
  }
  throw new Error("WELCOME_SOURCE_REVIEW");
}
