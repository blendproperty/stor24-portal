export function apiError(error: unknown) {
  if (error instanceof Error && error.message === "UNIT_STRUCTURE_PROTECTED") return Response.json({ error: { code: error.message, message: "This unit has a live booking or occupancy. Its physical details and availability require an approved operational workflow." } }, { status: 409 });
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "PRICE_GOVERNED_WORKFLOW_REQUIRED") return Response.json({ error: { code: message, message: "Saved online booking particulars require the booking price review workflow. Signed or paid bookings need finance review." } }, { status: 409 });
  if (message === "UAT_RESET_STOCK_REVIEW_REQUIRED") return Response.json({ error: { code: message, message: "Nothing was cleared. Merchandise stock reservations do not match the orders. Review the stock holds before resetting." } }, { status: 409 });
  if (message === "UAT_RESET_SCOPE_CONFLICT") return Response.json({ error: { code: message, message: "Nothing was cleared. A linked order or debit batch includes records outside this organisation. Review those links before resetting." } }, { status: 409 });
  if (message === "MOVE_OUT_DATE_RESTRICTED") return Response.json({ error: { code: message, message: "This date is not allowed by the store's saved move-out rules. Choose an allowed date. Dates are checked in South African time." } }, { status: 409 });
  if (message === "MOVE_OUT_POLICY_REVIEW") return Response.json({ error: { code: message, message: "The store's move-out date settings need administrator review before this move-out can proceed." } }, { status: 409 });
  if (message === "FLOOR_NOT_OPERATIONAL") return Response.json({ error: { code: message, message: "This floor is not operational. Please select a unit on an open floor." } }, { status: 409 });
  const status = message === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "FACILITY_FORBIDDEN", "FOLLOWUP_STAFF_FORBIDDEN", "PERSONAL_EXPORT_FORBIDDEN", "REPORT_SHARING_FORBIDDEN", "STAFF_EMAIL_FORBIDDEN", "STAFF_EMAIL_RECIPIENT_FORBIDDEN", "DEBICHECK_SECOND_TRANSPORT_FORBIDDEN"].includes(message) ? 403 : message === "NOT_FOUND" ? 404 : message === "CONFLICT" ? 409 : 500;
  return Response.json({ error: { code: status === 500 ? "INTERNAL_ERROR" : message, message: status === 500 ? "The request could not be completed." : message } }, { status });
}

export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { throw new Error("INVALID_JSON"); }
}
