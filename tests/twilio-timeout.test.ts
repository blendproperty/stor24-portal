import assert from "node:assert/strict";
import test from "node:test";
import { TwilioSmsProvider, TwilioWhatsAppProvider } from "../src/lib/integrations/twilio-provider";

test("Twilio SMS and WhatsApp requests have a bounded deadline without automatic resending", async t => {
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM", "TWILIO_WHATSAPP_FROM"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32); process.env.TWILIO_AUTH_TOKEN = "synthetic";
  process.env.TWILIO_SMS_FROM = "+27000000000"; process.env.TWILIO_WHATSAPP_FROM = "+27000000000";
  const context = { organisationId: "synthetic", idempotencyKey: "synthetic" };
  const message = { recipient: "+27000000001", body: "Synthetic only" };
  for (const kind of ["sms", "whatsapp", "template"]) {
    const send = () => kind === "sms" ? new TwilioSmsProvider().send(message, context) : kind === "whatsapp" ? new TwilioWhatsAppProvider().send(message, context) : new TwilioWhatsAppProvider().sendTemplate(message.recipient, "HX" + "0".repeat(32), { "1": "Synthetic only" }, context);
    await t.test(`${kind}: successful request preserves form and supplies deadline`, async t => {
      let calls = 0, deadlines = 0; const controller = new AbortController();
      t.mock.method(AbortSignal, "timeout", (ms: number) => { assert.equal(ms, 15_000); deadlines++; return controller.signal; });
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        calls++; assert.equal(init.signal, controller.signal);
        const fields = new URLSearchParams(String(init.body));
        assert.equal(fields.get("To"), kind === "sms" ? message.recipient : `whatsapp:${message.recipient}`);
        if (kind === "template") assert.equal(fields.get("ContentVariables"), JSON.stringify({ "1": "Synthetic only" }));
        else assert.equal(fields.get("Body"), message.body);
        return Response.json({ sid: "SMsynthetic" }, { status: 201 });
      });
      const result = await send(); assert.equal(result.ok, true); assert.equal(calls, 1); assert.equal(deadlines, 1);
    });
    await t.test(`${kind}: stalled request returns failure after abort and is not resent`, async t => {
      let calls = 0, deadlines = 0; const controller = new AbortController();
      t.mock.method(AbortSignal, "timeout", (ms: number) => { assert.equal(ms, 15_000); deadlines++; return controller.signal; });
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        calls++; assert.equal(init.signal, controller.signal);
        return new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
          queueMicrotask(() => controller.abort(new DOMException("Synthetic deadline", "TimeoutError")));
        });
      });
      const result = await send(); assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "NETWORK_ERROR");
      assert.equal(calls, 1); assert.equal(deadlines, 1);
    });
  }
});
