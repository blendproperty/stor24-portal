import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validBlendSignWebhookSignature } from "../src/lib/blendsign-webhook-security";

const body = JSON.stringify({ id: "evt_1", event: "envelope.completed", data: { envelopeId: "env_1" } });
const secret = "test-secret";
test("valid BlendSign webhook HMAC is accepted", () => assert.equal(validBlendSignWebhookSignature(body, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`, secret), true));
test("modified webhook body is rejected", () => assert.equal(validBlendSignWebhookSignature(`${body}x`, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`, secret), false));
test("missing or malformed webhook signature is rejected", () => { assert.equal(validBlendSignWebhookSignature(body, null, secret), false); assert.equal(validBlendSignWebhookSignature(body, "bad", secret), false); });
