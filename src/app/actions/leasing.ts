"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCustomer, createFacility, createLead, createReservation, createUnit, createUnitType, giveNotice, moveIn, moveOut, transfer } from "@/lib/leasing-service";
import { dispatchBlendSignLease } from "@/lib/blendsign-lease-service";
import { requireScope } from "@/lib/scope";
import { customerSchema, facilitySchema, leadSchema, moveInSchema, moveOutSchema, noticeSchema, reservationSchema, transferSchema, unitSchema, unitTypeSchema } from "@/lib/validators";
import { requirePermission } from "@/lib/auth-guards";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim() || undefined;
const number = (data: FormData, key: string) => text(data, key) ? Number(text(data, key)) : undefined;

export async function addFacilityAction(data: FormData) {
  const parsed = facilitySchema.parse({ name: text(data, "name"), code: text(data, "code"), timezone: "Africa/Johannesburg", active: true });
  await createFacility(await requireScope(), parsed); revalidatePath("/units");
}

export async function addCustomerAction(data: FormData) {
  const parsed = customerSchema.parse({ type: text(data, "type"), firstName: text(data, "firstName"), lastName: text(data, "lastName"), companyName: text(data, "companyName"), email: text(data, "email"), phone: text(data, "phone") });
  await createCustomer(await requireScope(), parsed); revalidatePath("/tenants");
}
export async function addLeadAction(data: FormData) {
  const parsed = leadSchema.parse({ facilityId: text(data, "facilityId"), customerId: text(data, "customerId"), desiredUnitTypeId: text(data, "desiredUnitTypeId"), source: text(data, "source"), notes: text(data, "notes"), expectedMoveIn: text(data, "expectedMoveIn") });
  await createLead(await requireScope(), parsed); revalidatePath("/leads");
}
export async function addUnitTypeAction(data: FormData) {
  const parsed = unitTypeSchema.parse({ facilityId: text(data, "facilityId"), name: text(data, "name"), widthMetres: number(data, "widthMetres"), lengthMetres: number(data, "lengthMetres"), areaSqMetres: number(data, "areaSqMetres"), features: [] });
  await createUnitType(await requireScope(), parsed); revalidatePath("/units");
}
export async function addUnitAction(data: FormData) {
  const parsed = unitSchema.parse({ facilityId: text(data, "facilityId"), unitTypeId: text(data, "unitTypeId"), number: text(data, "number"), floor: text(data, "floor"), zone: text(data, "zone"), monthlyRate: number(data, "monthlyRate"), taxRate: number(data, "taxRate") });
  await createUnit(await requireScope(), parsed); revalidatePath("/units");
}
export async function reserveAction(data: FormData) {
  const parsed = reservationSchema.parse({ facilityId: text(data, "facilityId"), customerId: text(data, "customerId"), leadId: text(data, "leadId"), unitId: text(data, "unitId"), quotedRate: number(data, "quotedRate"), holdExpiresAt: text(data, "holdExpiresAt"), intendedMoveIn: text(data, "intendedMoveIn") });
  await createReservation(await requireScope(), parsed); revalidatePath("/leads");
}

/**
 * Starts a move-in and sends the lease out for signature (DocuSign-style)
 * instead of completing it inline. The unit is held (RESERVED) and the
 * tenancy is created as DRAFT; both flip to live (OCCUPIED / ACTIVE) only
 * once the customer signs via the public /sign/[token] link emailed here.
 * See completeLeaseSigning() in leasing-service.ts for that second half.
 */
export async function moveInAction(data: FormData) {
  await requirePermission("move_in.create");
  const parsed = moveInSchema.parse({ reservationId: text(data, "reservationId"), facilityId: text(data, "facilityId"), customerId: text(data, "customerId"), unitId: text(data, "unitId"), startDate: text(data, "startDate"), monthlyRate: number(data, "monthlyRate"), initialCharge: number(data, "initialCharge") ?? 0, accessState: "PENDING", paymentMethod: text(data, "paymentMethod") });
  const scope = await requireScope();
  const result = await moveIn(scope, parsed);
  await dispatchBlendSignLease(scope, result, parsed);
  revalidatePath("/tenants"); revalidatePath("/operations/accounts"); redirect("/operations/accounts");
}
export async function transferAction(data: FormData) { await requirePermission("operations.manage"); const parsed = transferSchema.parse({ tenancyId: text(data, "tenancyId"), toUnitId: text(data, "toUnitId"), effectiveAt: text(data, "effectiveAt"), monthlyRate: number(data, "monthlyRate") }); await transfer(await requireScope(), parsed); revalidatePath("/tenants"); }
export async function noticeAction(data: FormData) { await requirePermission("collections.manage"); const parsed = noticeSchema.parse({ tenancyId: text(data, "tenancyId"), noticeDate: text(data, "noticeDate"), plannedMoveOut: text(data, "plannedMoveOut") }); await giveNotice(await requireScope(), parsed); revalidatePath("/tenants"); }
export async function moveOutAction(data: FormData) { await requirePermission("operations.manage"); const parsed = moveOutSchema.parse({ tenancyId: text(data, "tenancyId"), movedOutAt: text(data, "movedOutAt"), finalCharge: number(data, "finalCharge") ?? 0, depositAction: text(data, "depositAction") || "NONE", depositAmount: number(data, "depositAmount") ?? 0, idempotencyKey: text(data, "idempotencyKey"), notes: text(data, "notes") }); await moveOut(await requireScope(), parsed); revalidatePath("/tenants"); }
