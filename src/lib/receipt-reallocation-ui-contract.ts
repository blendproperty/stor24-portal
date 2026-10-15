import { z } from "zod";
import type { ReceiptReallocationInput } from "./receipt-reallocation-policy";

// Private scoped workspace only: no contacts, provider payloads or raw metadata.
// A limited account search must be narrowed; request history has a separate cursor.
const id = z.string().min(1).max(100);
const money = z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
const text = z.string().max(500);
export const receiptAccountSchema = z.object({ id, accountNumber: z.string().min(1).max(100), customerName: z.string().max(200), facilityId: id, balance: money });
const documentHref = z.string().max(500).refine(value => /^\/api\/v1\/[a-zA-Z0-9/_-]+(?:\?[a-zA-Z0-9_=&%-]+)?$/.test(value), "Use a protected same-origin document route");
export const receiptCorrectionRowSchema = z.object({
  id, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), status: z.enum(["PENDING_APPROVAL", "POSTED", "REJECTED", "CANCELLED"]),
  operation: z.enum(["MOVE", "UNDO"]), reversesId: id.nullable(), sourceAccountId: id, targetAccountId: id, sourceEntryId: id,
  facilityId: id, sourceAccountNumber: z.string().min(1).max(100), targetAccountNumber: z.string().min(1).max(100),
  targetLedgerEntryId: id.nullable(), amount: money, reason: text, evidenceReference: z.string().max(200), requestedById: id,
  requestedByName: z.string().max(200), createdAt: z.iso.datetime(), reviewReference: z.string().max(200).nullable(), postedAt: z.iso.datetime().nullable(),
  sourceDocumentHref: documentHref.nullable().optional(), targetDocumentHref: documentHref.nullable().optional(),
});
export const receiptCorrectionWorkspaceSchema = z.object({
  userId: id, capabilities: z.object({ canRequest: z.boolean(), canApprove: z.boolean() }),
  facilities: z.array(z.object({ id, name: z.string().max(200) })).max(100),
  accounts: z.array(receiptAccountSchema).max(200), accountsLimited: z.boolean(),
  receipts: z.array(z.object({ entryId: id, description: text, recordedAt: z.iso.datetime(), remaining: money, paymentReference: z.string().max(200) })).max(200),
  requests: z.array(receiptCorrectionRowSchema).max(50), nextCursor: z.string().min(1).max(500).nullable().optional(),
});
export const receiptCorrectionPreviewSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), operation: z.enum(["MOVE", "UNDO"]),
  source: z.object({ accountNumber: z.string().min(1).max(100), balance: money }),
  target: z.object({ accountNumber: z.string().min(1).max(100), balance: money }),
  amount: money, sourceBalanceAfter: money, targetBalanceAfter: money, sourceReceiptRemaining: money, notice: z.string().min(1).max(1000),
});
export type ReceiptCorrectionWorkspace = z.infer<typeof receiptCorrectionWorkspaceSchema>;
export type ReceiptCorrectionPreview = z.infer<typeof receiptCorrectionPreviewSchema>;
export type ReceiptCorrectionRow = z.infer<typeof receiptCorrectionRowSchema>;
export type ReceiptCorrectionAccount = z.infer<typeof receiptAccountSchema>;
export type ReceiptCorrectionCommand =
  | { action: "preview"; input: ReceiptReallocationInput }
  | { action: "request"; input: ReceiptReallocationInput; fingerprint: string; confirmed: true }
  | { action: "decide"; id: string; revision: number; decision: "approve" | "reject" | "cancel"; reference: string; confirmed: true };
export const RECEIPT_CORRECTION_ENDPOINT = "/api/v1/adjustments/receipt-reallocations";
