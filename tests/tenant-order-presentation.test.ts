import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source contract checks supplement CI compilation; they are not authenticated browser UAT.
test("purchase requests include selected unit and server filtering precedes the result limit", () => {
  const client = readFileSync("src/components/tenant-purchases.tsx", "utf8");
  const route = readFileSync("src/app/api/tenant/orders/route.ts", "utf8");
  assert.ok(client.includes("&unit=${encodeURIComponent(unitId)}"));
  assert.ok(route.includes("...(unitId ? { unitId } : {})"));
  assert.ok(route.includes("customer: tenantCustomerScope(session)"));
  assert.ok(route.indexOf("...(unitId ? { unitId } : {})") < route.indexOf("take: 100"));
});

test("order view uses tenant branding and receipts require a successful payment", () => {
  const shell = readFileSync("src/components/app-shell.tsx", "utf8");
  assert.ok(shell.includes('pathname.startsWith("/my/")'));
  const client = readFileSync("src/components/tenant-order-status.tsx", "utf8");
  const route = readFileSync("src/app/api/tenant/orders/[id]/route.ts", "utf8");
  assert.ok(client.includes('className="tenant-portal"'));
  assert.ok(client.includes("stor24-logo-official-email-20260909.svg"));
  assert.ok(client.includes("/api/tenant/documents/receipt/"));
  assert.ok(route.includes('payment?.status === "SUCCEEDED" ? payment.id : null'));
  assert.ok(route.includes("customer: tenantCustomerScope(session)"));
});
