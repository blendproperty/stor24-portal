import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { merchandiseCheckoutEnabled, merchandiseCheckoutTestMode } from "../src/lib/merchandise-checkout-access";

const session = { organisationId: "org-test", email: "tester@example.com" };
test("CSP permits the fixed Netcash form destination without allowing arbitrary hosts", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.ok(config.includes("form-action 'self' https://paynow.netcash.co.za"));
  assert.equal(config.includes("form-action *"), false);
});
const now = Date.parse("2026-09-11T13:00:00Z");
const config = {
  TENANT_MERCHANDISE_TEST_ORGANISATION_ID: "org-test",
  TENANT_MERCHANDISE_TEST_EMAIL: "tester@example.com",
  TENANT_MERCHANDISE_TEST_EXPIRES_AT: "2026-09-11T18:00:00Z",
};
test("R10 test requires separate opt-in and matching unexpired test identity, even with global checkout on", () => {
  assert.equal(merchandiseCheckoutTestMode(session, config, now), false);
  assert.equal(merchandiseCheckoutTestMode(session, { ...config, TENANT_MERCHANDISE_R10_TEST: "true" }, now), true);
  assert.equal(merchandiseCheckoutTestMode({ ...session, email: "other@example.com" }, { ...config, TENANT_MERCHANDISE_R10_TEST: "true", TENANT_MERCHANDISE_CHECKOUT_ENABLED: "true" }, now), false);
});
test("known pre-checkout failures unlock the basket without clearing retry protection", () => {
  const client = readFileSync("src/components/tenant-checkout.tsx", "utf8");
  const route = readFileSync("src/app/api/tenant/orders/route.ts", "utf8");
  assert.ok(client.includes("body.checkoutNotStarted === true"));
  assert.ok(client.includes("!body.data?.orderId"));
  assert.ok(route.includes("checkoutNotStarted: true"));
  assert.ok(client.includes("attempt.current?.basket !== basket"));
});
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

test("merchandise can use its organisation default provider without crossing stores or organisations", () => {
  const service = readFileSync("src/lib/payments/netcash-service.ts", "utf8");
  const client = readFileSync("src/lib/payments/netcash-client.ts", "utf8");
  assert.ok(service.includes("getNetcashConnection(session.organisationId, owned.facilityId, true)"));
  assert.ok(client.includes("!connection && facilityId && allowOrganisationDefault"));
  assert.ok(client.includes('where: { organisationId, facilityId: null, category: "PAYMENTS", provider: "NETCASH" }'));
});
