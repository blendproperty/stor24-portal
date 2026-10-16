import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { requireSession } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { sameOrigin } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { receiptReviewActionSchema } from "@/lib/unidentified-receipt-policy";
import { actOnUnidentifiedReceipt, captureUnidentifiedReceipt, unidentifiedReceiptAccounts, unidentifiedReceiptSources, unidentifiedReceiptWorkspace } from "@/lib/unidentified-receipt-service";

const id = z.string().min(1).max(100);
const messages: Record<string, string> = {
  RECEIPT_REVIEW_AMOUNT: "Use a positive ZAR amount in whole cents. Do not round imported evidence.",
  RECEIPT_REVIEW_DATE: "Choose a valid receipt date no later than today in South African time.",
  RECEIPT_REVIEW_SOURCE: "This original source is unavailable, already matched or not a supported credit. Review the original reconciliation.",
  RECEIPT_REVIEW_SOURCE_INTEGRITY: "The retained statement or selected row does not match its original evidence. Review the source file before continuing.",
  RECEIPT_REVIEW_SOURCE_PERMISSION: "Imported evidence needs organisation-wide receipt capture and settlement-view access.",
  RECEIPT_REVIEW_CHANGED: "The original evidence or target account changed. Refresh and investigate before a new matching review.",
  RECEIPT_REVIEW_DUPLICATE: "This evidence is already retained. Find the existing intake instead of recording it twice.",
  RECEIPT_REVIEW_TEST_SOURCE: "Test evidence stays separate and cannot be proposed against customer accounts.",
  RECEIPT_REVIEW_ACCOUNT: "Choose an account belonging to this store and organisation with consistent tenancy and ZAR currency.",
  RECEIPT_REVIEW_INDEPENDENT: "A reviewer must be different from both the person who captured the evidence and the person who proposed the match.",
};
function failure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the form fields and explicit confirmation." }, { status: 422 });
  const code = error instanceof Error ? error.message : "";
  if (["UNAUTHENTICATED", "FORBIDDEN", "FACILITY_FORBIDDEN", "NOT_FOUND"].includes(code)) return Response.json({ error: code === "UNAUTHENTICATED" ? "Sign in to continue." : "The requested review is unavailable in your access scope." }, { status: code === "UNAUTHENTICATED" ? 401 : code === "NOT_FOUND" ? 404 : 403 });
  if (messages[code]) return Response.json({ error: messages[code] }, { status: 409 });
  if (code === "CONFLICT" || (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code)))) return Response.json({ error: "The review changed or this evidence is already retained. Reload before continuing." }, { status: 409 });
  return Response.json({ error: "The review could not be completed. Reload and check the saved state before trying again." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const facilityId = params.has("facilityId") ? id.parse(params.get("facilityId")) : undefined;
    const scope = await requirePermissionScope("receipt_review.view", facilityId);
    if (params.get("mode") === "sources") {
      const capture = await requirePermissionScope("receipt_review.capture");
      const settlements = await requirePermissionScope("settlements.view");
      if (!scope.unrestrictedFacilities || !capture.unrestrictedFacilities || !settlements.unrestrictedFacilities) throw new Error("RECEIPT_REVIEW_SOURCE_PERMISSION");
      return Response.json(await unidentifiedReceiptSources(scope), { headers: { "cache-control": "no-store" } });
    }
    if (params.get("mode") === "accounts") {
      if (!facilityId) throw new Error("NOT_FOUND");
      await requirePermissionScope("ledger.view", facilityId);
      return Response.json(await unidentifiedReceiptAccounts(scope, facilityId, z.string().trim().min(2).max(80).parse(params.get("query"))), { headers: { "cache-control": "no-store" } });
    }
    const data = await unidentifiedReceiptWorkspace(scope, facilityId, params.has("cursor") ? id.parse(params.get("cursor")) : undefined);
    const auth = await requireSession();
    const allowed = (permission: string, store?: string) => currentRoleAccess(auth.user.roleAssignments, permission, store).allowed;
    return Response.json({ ...data, userId: scope.userId, canImportSources: scope.unrestrictedFacilities && currentRoleAccess(auth.user.roleAssignments, "receipt_review.capture").allowedFacilityIds === null && currentRoleAccess(auth.user.roleAssignments, "settlements.view").allowedFacilityIds === null && allowed("receipt_review.capture") && allowed("settlements.view"), facilities: data.facilities.map(f => ({ ...f, canCapture: allowed("receipt_review.capture", f.id), canPropose: allowed("receipt_review.propose", f.id) && allowed("ledger.view", f.id), canReview: allowed("receipt_review.approve", f.id) && allowed("ledger.view", f.id), canPost: ["receipt_review.post","receipt_review.approve","ledger.view","payments.manage","billing.view"].every(permission=>allowed(permission,f.id)) })) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "The request origin is not allowed." }, { status: 403 });
  try {
    await requirePermissionScope("receipt_review.view");
    const input = receiptReviewActionSchema.parse(JSON.parse((await boundedBody(new Response(request.body), 20000)).toString()));
    await requirePermissionScope("receipt_review.view", input.facilityId);
    const permission = input.action === "capture" ? "capture" : input.action === "review" ? "approve" : "propose";
    const scope = await requirePermissionScope(`receipt_review.${permission}`, input.facilityId);
    if (input.action === "capture") {
      if (input.source.sourceType !== "MANUAL_REPORTED") {
        const settlements = await requirePermissionScope("settlements.view");
        if (!settlements.unrestrictedFacilities || !scope.unrestrictedFacilities) throw new Error("RECEIPT_REVIEW_SOURCE_PERMISSION");
      }
      const capture = {facilityId: input.facilityId, requestKey: input.requestKey, source: input.source};
      return Response.json(await captureUnidentifiedReceipt(scope, capture), { status: 201 });
    }
    if (input.action !== "withdraw") await requirePermissionScope("ledger.view", input.facilityId);
    return Response.json(await actOnUnidentifiedReceipt(scope, input));
  } catch (error) { return failure(error); }
}
