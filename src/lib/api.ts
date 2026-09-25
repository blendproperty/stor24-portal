export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "MOVE_OUT_DATE_RESTRICTED") return Response.json({ error: { code: message, message: "This date is not allowed by the store's saved move-out rules. Choose an allowed date. Dates are checked in South African time." } }, { status: 409 });
  if (message === "MOVE_OUT_POLICY_REVIEW") return Response.json({ error: { code: message, message: "The store's move-out date settings need administrator review before this move-out can proceed." } }, { status: 409 });
  if (message === "FLOOR_NOT_OPERATIONAL") return Response.json({ error: { code: message, message: "This floor is not operational. Please select a unit on an open floor." } }, { status: 409 });
  const status = message === "UNAUTHENTICATED" ? 401 : message.includes("FORBIDDEN") ? 403 : message === "NOT_FOUND" ? 404 : message === "CONFLICT" ? 409 : 500;
  return Response.json({ error: { code: message, message: status === 500 ? "The request could not be completed." : message } }, { status });
}

export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { throw new Error("INVALID_JSON"); }
}
