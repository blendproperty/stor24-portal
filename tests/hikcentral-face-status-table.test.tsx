import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HikCentralFaceCaptureWorkspace } from "../src/components/hikcentral-face-capture-workspace";

test("customer table separates saved photos, provider acceptance and door access", () => {
  const html = renderToStaticMarkup(<HikCentralFaceCaptureWorkspace canSend canSyntheticTest people={[
    { customerId: "john", customerName: "John Test Wayne", personId: "S24EXAMPLE", linkStatus: "ACTIVE", photo: { id: "photo", version: 1, status: "PROVIDER_ACCEPTED", consentAt: "2026-11-18T12:00:00Z", providerAcceptedAt: "2026-11-18T12:01:00Z" } },
    { customerId: "new", customerName: "New Customer", personId: null, linkStatus: null, photo: null },
    { customerId: "reset", customerName: "Reset Customer", personId: null, linkStatus: "PENDING", photo: { id: "removed", version: 1, status: "PROVIDER_REMOVED", consentAt: "2026-11-18T12:00:00Z", providerAcceptedAt: "2026-11-18T12:01:00Z" } },
    { customerId: "locked", customerName: "Locked Customer", personId: "2001", linkStatus: "ACTIVE", photo: null, accessGrants: [{ facilityId: "facility", status: "LOCKED" }] },
    { customerId: "manual", customerName: "Manual Customer", personId: "2002", linkStatus: "ACTIVE", photo: null, accessGrants: [{ facilityId: "facility", status: "EXTERNAL" }] },
  ]} facilities={[{ id: "facility", name: "Store 1" }]} />);
  assert.match(html, /John Test Wayne/);
  assert.match(html, /Accepted by HikCentral/);
  assert.match(html, /S24EXAMPLE/);
  assert.match(html, /New Customer/);
  assert.match(html, /Not captured/);
  assert.match(html, /New photo needed/);
  assert.match(html, /Face reader access/);
  assert.match(html, /Not assigned/);
  assert.match(html, /View photo &amp; access/);
  assert.match(html, /face-status--success/);
  assert.match(html, /Locked · manager restore/);
  assert.match(html, /Manually assigned · review/);
});
