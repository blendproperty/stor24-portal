import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { checkPayNowTransactionStatus } from "../src/lib/payments/netcash-client";
import { abortable, boundedPayNowBody, boundedPayNowVerification, payNowCallback, PAY_NOW_CALLBACK_BYTES, PAY_NOW_VERIFICATIONS_PER_PROCESS } from "../src/lib/payments/netcash-pay-now-security";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Synthetic persistence arguments.
type Verification = { reference: string; amount: string; accepted: boolean };
const callback = (body: string, headers: Record<string, string> = {}) => new Request("https://example.invalid/api/webhooks/netcash", { method: "POST", body, headers });
test("callback bounds actual bytes, multibyte chunks, critical duplicate fields and decoded identifiers", async () => {
  assert.deepEqual(await payNowCallback(callback("Reference=PMT1&RequestTrace=114.228862205218&Reason=Card+accepted")), { Reference: "PMT1", RequestTrace: "114.228862205218", Reason: "Card accepted" });
  for (const body of ["Reference=PMT1&Reference=PMT2", "RequestTrace=a&RequestTrace=b", "Reference=%0aPMT1", `RequestTrace=${"x".repeat(129)}`, "", Array.from({ length: 65 }, (_, i) => `k${i}=v`).join("&")]) {
    await assert.rejects(payNowCallback(callback(body)), /NETCASH_PAYLOAD_INVALID/);
  }
  await assert.rejects(payNowCallback(callback("x=" + "a".repeat(PAY_NOW_CALLBACK_BYTES))), /NETCASH_BODY_TOO_LARGE/);
  await assert.rejects(payNowCallback(callback("x=a", { "content-length": String(PAY_NOW_CALLBACK_BYTES + 1) })), /NETCASH_BODY_TOO_LARGE/);
  const bytes = new TextEncoder().encode("é".repeat(8));
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 5)); c.enqueue(bytes.slice(5)); c.close(); } }), { headers: { "content-length": "1" } });
  await assert.rejects(boundedPayNowBody(response, 15, new AbortController().signal), /NETCASH_BODY_TOO_LARGE/);
});

test("stalled body and stalled cancellation cannot retain a read past its deadline", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }));
  const result = boundedPayNowBody(response, 10, controller.signal);
  controller.abort();
  await assert.rejects(result, /NETCASH_REQUEST_TIMEOUT/);
  assert.equal(cancelled, true);
  await assert.rejects(abortable(Promise.reject(Error("synthetic failure")), controller.signal), /NETCASH_REQUEST_TIMEOUT/);
});

test("verification accepts normal pending/accepted data and rejects malformed or differently bound evidence", async () => {
  for (const payload of [null, [], {}, { TransactionAccepted: "true", Amount: "10.00", Reference: "PMT1" }, { TransactionAccepted: true }, { TransactionAccepted: true, Amount: {}, Reference: "PMT1" }, { TransactionAccepted: true, Amount: "NaN", Reference: "PMT1" }, { TransactionAccepted: true, Amount: "-1", Reference: "PMT1" }, { RequestTrace: "other", TransactionAccepted: false }]) {
    await assert.rejects(checkPayNowTransactionStatus("trace", async () => Response.json(payload)), /NETCASH_TRANSACTION_STATUS_RESPONSE_INVALID/);
  }
  const pending = await checkPayNowTransactionStatus("trace", async () => Response.json({ TransactionAccepted: false, Reference: "PMT1", Reason: "Pending" }));
  assert.equal(pending.accepted, false); assert.equal(pending.amount, undefined);
  const verified = await checkPayNowTransactionStatus("trace", async (_url, options) => {
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store"); assert.ok(options?.signal);
    return Response.json({ RequestTrace: "trace", TransactionAccepted: true, Amount: "10.50", Reference: "PMT1" });
  });
  assert.equal(verified.amount, "10.50"); assert.equal(verified.accepted, true);
  await assert.rejects(checkPayNowTransactionStatus("trace", async () => new Response("private-provider-details", { status: 500 })), error => String(error) === "Error: NETCASH_TRANSACTION_STATUS_HTTP_500");
  await assert.rejects(checkPayNowTransactionStatus("trace", async () => new Response("x".repeat(65537))), /NETCASH_TRANSACTION_STATUS_RESPONSE_INVALID/);
});

test("header and body stalls fail closed and verification capacity is released", async () => {
  const original = AbortSignal.timeout;
  try {
    for (const phase of ["headers", "body"]) {
      const controller = new AbortController();
      AbortSignal.timeout = () => controller.signal;
      const verification = checkPayNowTransactionStatus("trace", async () => {
        queueMicrotask(() => controller.abort());
        return phase === "headers" ? new Promise<Response>(() => {}) : new Response(new ReadableStream());
      });
      await assert.rejects(verification, /NETCASH_TRANSACTION_STATUS_(UNAVAILABLE|RESPONSE_INVALID)/);
    }
  } finally { AbortSignal.timeout = original; }
  const releases: Array<() => void> = [];
  const running = Array.from({ length: PAY_NOW_VERIFICATIONS_PER_PROCESS }, () => boundedPayNowVerification(() => new Promise<void>(resolve => releases.push(resolve))));
  await assert.rejects(boundedPayNowVerification(async () => undefined), /NETCASH_TRANSACTION_STATUS_BUSY/);
  releases.forEach(release => release()); await Promise.all(running);
  assert.equal(await boundedPayNowVerification(async () => "available"), "available");
  await assert.rejects(boundedPayNowVerification(async () => { throw Error("failure"); }), /failure/);
  assert.equal(await boundedPayNowVerification(async () => "available"), "available");
});

async function webhookFixture() {
  let inbox: Row | null = null, verification: Verification | Error = { reference: "PMT1", amount: "10.00", accepted: true }, settlements = 0, writes = 0;
  const database = {
    payment: { findFirst: async () => ({ id: "payment", providerRef: "PMT1", accountId: "account", amount: "10.00" }) },
    account: { findUnique: async () => ({ customer: { organisationId: "org" } }) },
    merchandiseOrder: { findUnique: async () => null },
    webhookInbox: {
      create: async ({ data }: Row) => { writes++; if (inbox) throw Error("Unique constraint"); return inbox = { id: "inbox", ...data }; },
      findFirst: async () => inbox && ["PENDING", "FAILED"].includes(inbox.status) ? inbox : null,
      update: async ({ data }: Row) => { writes++; return Object.assign(inbox!, data); },
    },
  };
  const hooks = { database, verify: async () => { if (verification instanceof Error) throw verification; return verification; }, settle: async () => { settlements++; return { terminal: (verification as Verification).accepted, financial: (verification as Verification).accepted }; } };
  const output = await build({ absWorkingDir: process.cwd(), tsconfig: "tsconfig.json", entryPoints: ["src/app/api/webhooks/netcash/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-webhook", setup(b) {
    const modules: Record<string, string> = {
      "@/lib/db": "export const db=__hooks.database;",
      "@/lib/payments/netcash-client": "export const checkPayNowTransactionStatus=__hooks.verify;",
      "@/lib/payments/booking-payment-settlement": "export const settleVerifiedBookingPayment=__hooks.settle;",
      "@/lib/payments/booking-confirmation-email": "export async function deliverBookingConfirmation() {}",
      "@/lib/finance/mri-export": "export async function enqueueMriExport() {}",
      "@/lib/merchandise-order-settlement": "export async function settleVerifiedMerchandisePayment() { throw Error('unexpected'); }",
    };
    b.onResolve({ filter: /^@\/lib\// }, a => modules[a.path] ? { path: a.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: modules[a.path] }));
  } }] });
  const loaded = { exports: {} as { POST: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__hooks", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, hooks);
  return { ...loaded.exports, inbox: () => inbox!, settlements: () => settlements, writes: () => writes, verify: (v: Verification | Error) => { verification = v; } };
}

test("callback rejection precedes persistence; verification failure, pending and completed replay retain reconciliation semantics", async () => {
  const f = await webhookFixture();
  assert.equal((await f.POST(callback("Reference=x&Reference=y"))).status, 400); assert.equal(f.writes(), 0);
  assert.equal((await f.POST(callback("x=" + "a".repeat(65536)))).status, 413); assert.equal(f.writes(), 0);
  f.verify(Error("NETCASH_TRANSACTION_STATUS_BUSY"));
  const request = () => callback("Reference=PMT1&RequestTrace=trace");
  assert.equal((await f.POST(request())).status, 503); assert.equal(f.inbox().status, "FAILED"); assert.equal(f.settlements(), 0);
  f.verify({ reference: "OTHER", amount: "10.00", accepted: true });
  await f.POST(request()); assert.equal(f.settlements(), 0); assert.equal(f.inbox().failureCode, "NETCASH_VERIFICATION_MISMATCH");
  f.verify({ reference: "PMT1", amount: "9.00", accepted: true });
  await f.POST(request()); assert.equal(f.settlements(), 0);
  f.verify({ reference: "PMT1", amount: "10.00", accepted: false });
  await f.POST(request()); assert.equal(f.inbox().status, "PENDING");
  f.verify({ reference: "PMT1", amount: "10.00", accepted: true });
  await f.POST(request()); assert.equal(f.inbox().status, "SUCCEEDED"); assert.equal(f.settlements(), 2);
  await f.POST(request()); assert.equal(f.settlements(), 2);
});
