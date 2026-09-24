import assert from "node:assert/strict";
import test from "node:test";
import { emailProvider } from "../src/lib/email";

const message = { to: "recipient@example.invalid", subject: "Synthetic", text: "Synthetic only", html: "<p>Synthetic only</p>" };
const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "RESEND_API_KEY", "SENDGRID_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_EMAIL_FROM"] as const;

test("email providers bound requests and never automatically retry", async t => {
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
  process.env.EMAIL_FROM = "Synthetic <sender@example.invalid>";
  process.env.RESEND_API_KEY = "synthetic"; process.env.SENDGRID_API_KEY = "synthetic";
  process.env.TWILIO_ACCOUNT_SID = "synthetic"; process.env.TWILIO_AUTH_TOKEN = "synthetic";
  process.env.TWILIO_EMAIL_FROM = "sender@example.invalid";
  for (const provider of ["resend", "sendgrid", "twilio"]) {
    await t.test(`${provider}: successful send preserves payload and supplies a 15-second deadline`, async t => {
      process.env.EMAIL_PROVIDER = provider;
      const controller = new AbortController(); let calls = 0;
      t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { assert.equal(milliseconds, 15_000); return controller.signal; });
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        calls++; assert.equal(init.signal, controller.signal); assert.equal(init.method, "POST");
        const payload = JSON.parse(String(init.body));
        if (provider === "resend") assert.equal(payload.to, message.to);
        else if (provider === "sendgrid") assert.equal(payload.personalizations[0].to[0].email, message.to);
        else assert.equal(payload.to[0].address, message.to);
        assert.ok(String(init.body).includes("Synthetic only"));
        return new Response(null, { status: 202 });
      });
      await emailProvider().send(message); assert.equal(calls, 1);
    });
    await t.test(`${provider}: stalled provider aborts without a second attempt`, async t => {
      process.env.EMAIL_PROVIDER = provider;
      const controller = new AbortController(), reason = new DOMException("Synthetic timeout", "TimeoutError");
      let calls = 0;
      t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { assert.equal(milliseconds, 15_000); return controller.signal; });
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        calls++; assert.equal(init.signal, controller.signal);
        return new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
          queueMicrotask(() => controller.abort(reason));
        });
      });
      await assert.rejects(emailProvider().send(message), error => error === reason);
      assert.equal(calls, 1);
    });
    await t.test(`${provider}: rejected delivery reports status without response contents`, async t => {
      process.env.EMAIL_PROVIDER = provider; let calls = 0;
      t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("Synthetic private response body", { status: 503 }); });
      await assert.rejects(emailProvider().send(message), { message: "Email provider rejected request (503)." });
      assert.equal(calls, 1);
    });
  }
});
