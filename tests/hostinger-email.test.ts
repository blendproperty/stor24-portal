import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { HostingerEmailProvider } from "../src/lib/hostinger-email";
import { emailProvider } from "../src/lib/email";

const message = { to: "recipient@example.invalid", subject: "Synthetic", text: "Synthetic text", html: "<p>Synthetic</p>", dlp: { organisationId: "test", resourceId: "test", approvedRecipient: "recipient@example.invalid" } };

test("Hostinger transport is opt-in, TLS-only, guarded, single-recipient and never retries uncertain sends", async t => {
  const password = process.env.HOSTINGER_SMTP_PASSWORD, provider = process.env.EMAIL_PROVIDER;
  t.after(() => { if (password === undefined) delete process.env.HOSTINGER_SMTP_PASSWORD; else process.env.HOSTINGER_SMTP_PASSWORD = password; if (provider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = provider; });
  process.env.EMAIL_PROVIDER = "hostinger";
  process.env.HOSTINGER_SMTP_PASSWORD = "synthetic-secret";
  let calls = 0, closes = 0, guarded = 0;
  let outcome: "accepted" | "rejected" | "unknown" = "accepted";
  t.mock.method(nodemailer, "createTransport", (options: Record<string, unknown>) => {
    assert.equal(options.host, "smtp.hostinger.com"); assert.equal(options.port, 465); assert.equal(options.secure, true);
    assert.deepEqual(options.auth, { user: "bookings@stor24.co.za", pass: "synthetic-secret" });
    assert.deepEqual(options.tls, { servername: "smtp.hostinger.com", minVersion: "TLSv1.2", rejectUnauthorized: true });
    assert.equal(options.pool, false); assert.equal(options.debug, false); assert.equal(options.logger, false);
    assert.equal(options.socketTimeout, 15000); assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    return { close() { closes++; }, async sendMail(payload: Record<string, unknown>) {
      calls++; assert.deepEqual(payload.envelope, { from: "bookings@stor24.co.za", to: [message.to] });
      assert.deepEqual(payload.from, { name: "Stor24", address: "bookings@stor24.co.za" });
      assert.equal(payload.text, message.text); assert.equal(payload.html, message.html); assert.equal(payload.dlp, undefined);
      if (outcome === "unknown") throw new Error("private recipient@example.invalid synthetic-secret");
      return { accepted: outcome === "accepted" ? [message.to] : [], rejected: outcome === "rejected" ? [message.to] : [] };
    } };
  });
  const protectedProvider = emailProvider(async () => { guarded++; return {} as Awaited<ReturnType<typeof import("../src/lib/dlp-transfer-service").guardDlpTransfer>>; });
  await protectedProvider.send(message); assert.equal(guarded, 1); assert.equal(calls, 1); assert.equal(closes, 1);
  await assert.rejects(emailProvider(async () => { throw new Error("DLP_DENIED"); }).send(message), /DLP_DENIED/); assert.equal(calls, 1);
  const { dlp: _dlp, ...noContext } = message; void _dlp;
  await assert.rejects(protectedProvider.send(noContext), /DLP_CONTEXT_REQUIRED/); assert.equal(calls, 1);
  for (const result of ["rejected", "unknown"] as const) { outcome = result; await assert.rejects(protectedProvider.send(message), { message: "Hostinger SMTP send failed or outcome uncertain; review before retrying." }); }
  assert.equal(calls, 3); assert.equal(closes, 3);
  await assert.rejects(new HostingerEmailProvider().send({ ...message, to: "a@example.invalid,b@example.invalid" }), /Invalid email/); assert.equal(calls, 3);
  delete process.env.HOSTINGER_SMTP_PASSWORD;
  await assert.rejects(protectedProvider.send(message), /credential is not configured/); assert.equal(calls, 3);
  assert.equal(process.env.EMAIL_PROVIDER, "hostinger");
});
