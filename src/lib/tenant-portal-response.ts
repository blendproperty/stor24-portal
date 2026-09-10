export const tenantPrivateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export function tenantError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "TENANT_RATE_LIMITED") return Response.json({ error: "Please wait a minute before downloading more documents." }, { status: 429, headers: tenantPrivateHeaders });
  if (code === "TENANT_UNAUTHENTICATED") return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401, headers: tenantPrivateHeaders });
  if (code === "TENANT_NOT_FOUND") return Response.json({ error: "This item is not available for your account." }, { status: 404, headers: tenantPrivateHeaders });
  if (code === "INVALID_PERIOD") return Response.json({ error: "Choose valid statement dates in order." }, { status: 422, headers: tenantPrivateHeaders });
  return Response.json({ error: "This item is temporarily unavailable. Please contact STOR24 if it continues." }, { status: 503, headers: tenantPrivateHeaders });
}
export function tenantPdf(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), { headers: { ...tenantPrivateHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` } });
}
