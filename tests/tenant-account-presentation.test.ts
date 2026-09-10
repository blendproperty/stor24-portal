import assert from "node:assert/strict";
import test from "node:test";
import { preferredTenantAccount, tenantAccountLabel, type TenantAccount } from "../src/lib/tenant-account-presentation";
const base: TenantAccount = { id: "unassigned", accountNumber: "REF", balance: "-10", currency: "ZAR", tenancy: null };
const active: TenantAccount = { ...base, id: "active", tenancy: { status: "ACTIVE", facility: { name: "Midpoint" }, occupancies: [{ unit: { number: "106" } }] } };
test("account selection preserves valid deep links and otherwise prefers an active tenancy", () => {
  const accounts = [base, active];
  assert.equal(preferredTenantAccount(accounts), "active");
  assert.equal(preferredTenantAccount(accounts, "unassigned"), "unassigned");
  assert.equal(preferredTenantAccount(accounts, "unknown"), "active");
  assert.equal(preferredTenantAccount([base]), "unassigned");
  assert.equal(preferredTenantAccount([]), "");
  assert.equal(accounts.length, 2);
});
test("labels do not invent a unit or classify unassigned accounts as test data", () => {
  assert.equal(tenantAccountLabel(base), "Account without an assigned unit");
  assert.equal(tenantAccountLabel(active), "Midpoint · Unit 106");
});
