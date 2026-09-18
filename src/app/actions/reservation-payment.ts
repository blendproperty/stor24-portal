"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";
import { recordReservationReceipt, reservationReceiptSchema } from "@/lib/reservation-payment";

export async function recordReservationPaymentAction(form: FormData) {
  const parsed = reservationReceiptSchema.safeParse({ ...Object.fromEntries(form.entries()), realPaymentConfirmed: form.get("realPaymentConfirmed") === "on" });
  if (!parsed.success) return { error: "Check the amount, receipt reference and received date, and confirm that real funds were received." };
  try {
    const scope = await requirePermissionScope("payments.manage");
    const reservation = await db.reservation.findFirst({ where: { id: parsed.data.reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, select: { facilityId: true } });
    if (!reservation) return { error: "This booking is unavailable or outside your payment permissions." };
    const authorised = await requirePermissionScope("payments.manage", reservation.facilityId);
    await recordReservationReceipt(authorised, parsed.data);
    revalidatePath("/operations/move-in"); revalidatePath("/operations/accounts"); revalidatePath("/my");
    return { success: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return { error: code === "BOOKING_RECEIPT_REFERENCE_EXISTS" ? "This receipt reference is already recorded. Refresh the payment checks before adding anything." : code === "FORBIDDEN" ? "You need payment-recording permission for this store." : "The payment could not be recorded. Refresh and review the booking before retrying with the same receipt details." };
  }
}
