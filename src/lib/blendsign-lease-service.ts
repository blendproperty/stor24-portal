import { createBlendSignLeaseEnvelope } from "@/lib/blendsign-client";
import { db } from "@/lib/db";
import { attachBlendSignEnvelope, type MoveInResult } from "@/lib/leasing-service";
import type { RequestScope } from "@/lib/scope";

export async function dispatchBlendSignLease(scope: RequestScope, result: MoveInResult, input: { paymentMethod: "DEBIT_ORDER" | "CARD" | "EFT" | "OTHER"; startDate: Date; monthlyRate?: number }) {
  const [representative, storeInformation] = await Promise.all([
    db.user.findUnique({ where: { id: scope.userId }, select: { name: true, email: true } }),
    db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: result.facility.id, domain: "STORE_INFORMATION", name: "Default", status: "READY" }, select: { config: true } }),
  ]);
  if (!representative) throw new Error("UNAUTHENTICATED");
  const envelope = await createBlendSignLeaseEnvelope({
    documentId: result.document.id,
    tenancyId: result.tenancy.id,
    paymentMethod: input.paymentMethod,
    customer: result.customer,
    facility: { ...result.facility, storeInformation: storeInformation?.config },
    unit: result.unit,
    startDate: input.startDate,
    monthlyRate: Number(input.monthlyRate ?? result.unit.monthlyRate),
    representative,
  });
  await attachBlendSignEnvelope(scope, result.document.id, envelope);
  return envelope;
}
