import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { merchandiseCheckoutEnabled } from "../src/lib/merchandise-checkout-access";

const session = { organisationId: "org-test", email: "tester@example.com" };
const now = Date.parse("2026-09-11T13:00:00Z");
const config = {
  TENANT_MERCHANDISE_TEST_ORGANISATION_ID: "org-test",
  TENANT_MERCHANDISE_TEST_EMAIL: "tester@example.com",
  TENANT_MERCHANDISE_TEST_EXPIRES_AT: "2026-09-11T18:00:00Z",
};
test("checkout is off by default; global approval remains explicit", () => {
  assert.equal(merchandiseCheckoutEnabled(session, {}, now), false);
  assert.equal(merchandiseCheckoutEnabled(session, { TENANT_MERCHANDISE_CHECKOUT_ENABLED: "false" }, now), false);
  assert.equal(merchandiseCheckoutEnabled(session, { TENANT_MERCHANDISE_CHECKOUT_ENABLED: "true" }, now), true);
});
test("controlled access requires exact organisation and email, and unexpired configuration", () => {
  assert.equal(merchandiseCheckoutEnabled(session, config, now), true);
  assert.equal(merchandiseCheckoutEnabled({ ...session, email: " TESTER@EXAMPLE.COM " }, config, now), true);
  assert.equal(merchandiseCheckoutEnabled({ ...session, organisationId: "other" }, config, now), false);
  assert.equal(merchandiseCheckoutEnabled({ ...session, email: "other@example.com" }, config, now), false);
  assert.equal(merchandiseCheckoutEnabled({ ...session, email: "tester@example.com.attacker.test" }, config, now), false);
  for (const expiry of [undefined, "invalid", "2026-09-11T13:00:00Z", "2026-09-10T18:00:00Z"]) {
    assert.equal(merchandiseCheckoutEnabled(session, { ...config, TENANT_MERCHANDISE_TEST_EXPIRES_AT: expiry }, now), false);
  }
  assert.equal(merchandiseCheckoutEnabled(session, { ...config, TENANT_MERCHANDISE_TEST_EMAIL: "" }, now), false);
});
test("catalogue, stock hold and payment form use the same authenticated-session gate", () => {
  for (const path of ["src/lib/merchandise-order-service.ts", "src/lib/payments/netcash-service.ts"]) {
    assert.ok(readFileSync(path, "utf8").includes("assertMerchandiseCheckoutEnabled(session)"));
  }
  const catalogue = readFileSync("src/app/api/tenant/merchandise/route.ts", "utf8");
  assert.ok(catalogue.includes("await requireTenantSession()"));
  assert.ok(catalogue.includes("merchandiseCheckoutEnabled(session)"));
});
