type CheckoutSession = { organisationId: string; email: string };
type CheckoutConfig = {
  TENANT_MERCHANDISE_CHECKOUT_ENABLED?: string;
  TENANT_MERCHANDISE_TEST_ORGANISATION_ID?: string;
  TENANT_MERCHANDISE_TEST_EMAIL?: string;
  TENANT_MERCHANDISE_TEST_EXPIRES_AT?: string;
};

/** Call only with the server-authenticated tenant session, never request input.
 * Test access changes eligibility, NOT the provider environment or amount.
 */
export function merchandiseCheckoutEnabled(session: CheckoutSession, config: CheckoutConfig = process.env, now = Date.now()) {
  if (config.TENANT_MERCHANDISE_CHECKOUT_ENABLED === "true") return true;
  const organisationId = config.TENANT_MERCHANDISE_TEST_ORGANISATION_ID?.trim();
  const email = config.TENANT_MERCHANDISE_TEST_EMAIL?.trim().toLowerCase();
  const expiresAt = Date.parse(config.TENANT_MERCHANDISE_TEST_EXPIRES_AT ?? "");
  return Boolean(organisationId && email && email.includes("@") &&
    session.organisationId === organisationId && session.email.trim().toLowerCase() === email &&
    Number.isFinite(expiresAt) && now < expiresAt);
}

export function assertMerchandiseCheckoutEnabled(session: CheckoutSession) {
  if (!merchandiseCheckoutEnabled(session)) throw new Error("MERCHANDISE_CHECKOUT_DISABLED");
}
