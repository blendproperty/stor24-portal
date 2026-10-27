"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { moveIn } from "@/lib/leasing-service";
import { dispatchBlendSignLease } from "@/lib/blendsign-lease-service";
import { requireScope } from "@/lib/scope";
import { moveInSchema } from "@/lib/validators";
import { confirmReservationMoveIn } from "@/lib/reservation-move-in";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim() || undefined;
const number = (data: FormData, key: string) => text(data, key) ? Number(text(data, key)) : undefined;

/**
 * Creates the pending lease, then continues directly to assisted signing.
 * Email follow-up is an explicit alternative. Saved signing evidence still
 * determines completion; opening a signing session never completes a lease.
 */
export async function moveInAction(data: FormData) {
  const parsed = moveInSchema.parse({ reservationId: text(data, "reservationId"), facilityId: text(data, "facilityId"), customerId: text(data, "customerId"), unitId: text(data, "unitId"), startDate: text(data, "startDate"), monthlyRate: number(data, "monthlyRate"), initialCharge: number(data, "initialCharge") ?? 0, initialRentPolicy: text(data,"initialRentMode") && text(data,"initialRentMode") !== "MANUAL" ? {mode:text(data,"initialRentMode"),cutoffDay:number(data,"initialRentCutoff"),approvalReference:text(data,"initialRentApproval")} : undefined, accessState: "PENDING", paymentMethod: text(data, "paymentMethod") });
  const scope = await requirePermissionScope("move_in.create", parsed.facilityId);
  const result = await moveIn(scope, parsed);
  const invitationDelivery = data.get("invitationDelivery") === "EMAIL" ? "EMAIL" : "ASSISTED";
  try {
    await dispatchBlendSignLease(scope, result, { ...parsed, invitationDelivery });
  } catch {
    // Preserve the saved booking/account and offer recovery without a second move-in.
    revalidatePath("/operations/accounts");
    redirect(`/operations/lease-signing?document=${encodeURIComponent(result.document.id)}&dispatch=failed`);
  }
  revalidatePath("/tenants"); revalidatePath("/operations/accounts");
  redirect(invitationDelivery === "ASSISTED" ? `/operations/lease-signing?document=${encodeURIComponent(result.document.id)}` : `/operations/accounts?accountId=${encodeURIComponent(result.tenancy.accountId)}`);
}

export async function confirmReservationMoveInAction(data: FormData): Promise<{ error: string } | undefined> {
  const reservationId = text(data, "reservationId");
  if (!reservationId || data.get("handoverConfirmed") !== "on") return { error: "Confirm the customer's identity and key handover before continuing." };
  const visible = await requireScope();
  const reservation = await db.reservation.findFirst({ where: { id: reservationId, facility: facilityWhere(visible) }, select: { facilityId: true } });
  if (!reservation) return { error: "This booking is unavailable. Refresh and select it again." };
  const scope = await requirePermissionScope("move_in.create", reservation.facilityId);
  try {
    await confirmReservationMoveIn(scope, reservationId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["FLOOR_NOT_OPERATIONAL", "MOVE_IN_NOT_READY", "MOVE_IN_REVIEW_REQUIRED", "MOVE_IN_DOCUMENT_REVIEW", "CONFLICT"].includes(code)) {
      return { error: "The booking cannot be moved in yet. Refresh to check the signed agreement, cleared payment, accepted ID, approved access photo, move-in date and unit availability. No handover was recorded." };
    }
    throw error;
  }
  for (const path of ["/tenants", "/units", "/reservations", "/operations/accounts", "/operations/move-in", "/my"]) revalidatePath(path);
  redirect(`/operations/move-in?reservation=${encodeURIComponent(reservationId)}`);
}
