import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { accountPaymentSchema } from "@/lib/validators";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

export async function GET() {
  try {
    const { organisationId, allowedFacilityIds } = await requirePermission("ledger.view");
    const accounts = await db.account.findMany({
      where: { customer: { organisationId }, tenancy: allowedFacilityIds ? { facilityId: { in: allowedFacilityIds } } : undefined },
      include: { customer: true, tenancy: { include: { facility: true, documents: { where: { type: "LEASE_AGREEMENT" }, orderBy: { createdAt: "desc" } }, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { include: { unitType: true } } } } } }, ledgerEntries: { orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], take: 50 }, payments: { orderBy: { createdAt: "desc" }, take: 25 } },
      orderBy: { updatedAt: "desc" }, take: 250,
    });
    const facilities = await db.facility.findMany({ where: { organisationId, active: true, ...(allowedFacilityIds ? { id: { in: allowedFacilityIds } } : {}) }, include: { units: { where: { status: "AVAILABLE" }, include: { unitType: true }, orderBy: { number: "asc" } } }, orderBy: { name: "asc" } });
    return Response.json({ data: { accounts, facilities } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const parsed = accountPaymentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { message: "Check the payment details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const actor = await requirePermission("payments.manage");
    const account = await db.account.findFirst({ where: { id: parsed.data.accountId, customer: { organisationId: actor.organisationId } }, include: { customer: true, tenancy: { include: { facility: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: true }, take: 1 } } } } });
    if (!account?.tenancy) return Response.json({ error: { message: "Account not found." } }, { status: 404 });
    await requirePermission("payments.manage", account.tenancy.facilityId);
    const idempotencyKey = `manual-${randomUUID()}`;
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: { accountId: account.id, amount: parsed.data.amount, method: parsed.data.method, status: "SUCCEEDED", processedAt: parsed.data.receivedAt, idempotencyKey, providerRef: parsed.data.reference || null } });
      const ledger = await tx.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: parsed.data.amount, description: `${parsed.data.method.replace("_", " ")} payment`, effectiveAt: parsed.data.receivedAt, externalRef: idempotencyKey, createdById: actor.user.id, metadata: parsed.data.reference ? { reference: parsed.data.reference } : undefined } });
      const updated = await tx.account.update({ where: { id: account.id }, data: { balance: { decrement: parsed.data.amount } } });
      await tx.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: account.tenancy!.facilityId, actorId: actor.user.id, action: "payment.posted", entityType: "Payment", entityId: payment.id, after: { accountId: account.id, amount: parsed.data.amount, method: parsed.data.method, ledgerEntryId: ledger.id } } });
      return { payment, balance: updated.balance };
    });
    if (account.customer.phone) await sendWhatsAppTemplate({ organisationId: actor.organisationId, facilityId: account.tenancy.facilityId, customerId: account.customer.id, recipient: account.customer.phone, consent: account.customer.communicationConsent, messageType: "PAYMENT_RECEIVED", idempotencyKey: `${idempotencyKey}:WHATSAPP`, variables: { "1": account.customer.firstName || account.customer.companyName || "customer", "2": `R${parsed.data.amount.toFixed(2)}`, "3": formatSouthAfricaDate(parsed.data.receivedAt), "4": account.accountNumber, "5": `R${Number(result.balance).toFixed(2)}` } });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) { return authErrorResponse(error); }
}
