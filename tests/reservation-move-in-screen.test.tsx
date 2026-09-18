import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReservationMoveInConfirmation } from "../src/components/reservation-move-in-confirmation";

test("a signed paid booking presents handover and the original document, never another signing form", () => {
  const html = renderToStaticMarkup(<ReservationMoveInConfirmation reservationId="booking" customerName="CI customer" unitNumber="107" onBack={() => {}} readiness={{ signed: true, leaseId: "original", signedAt: "2026-09-18", requiredAmount: 1100, paidAmount: 1100, paymentVerified: true, testPayment: false, startDate: "2026-09-18", ready: true, blockers: [] }} />);
  assert.match(html, /Ready for key collection/);
  assert.match(html, /Confirm move-in \/ key handover/);
  assert.match(html, /public-leases\/original\/signed-pdf/);
  assert.match(html, /<input(?=[^>]*name="handoverConfirmed")(?=[^>]*required)[^>]*>/);
  assert.doesNotMatch(html, /Send lease for signature|pending attorney|name="initialCharge"/);
});

test("test payments keep the signed agreement visible and disable handover", () => {
  const html = renderToStaticMarkup(<ReservationMoveInConfirmation reservationId="booking" customerName="CI customer" unitNumber="107" onBack={() => {}} readiness={{ signed: true, leaseId: "original", signedAt: "2026-09-18", requiredAmount: 1100, paidAmount: 0, paymentVerified: false, testPayment: true, startDate: "2026-09-18", ready: false, blockers: ["A test payment is recorded. It does not clear the real booking for key collection."] }} />);
  assert.match(html, /Agreement signed/);
  assert.match(html, /A test payment is recorded/);
  assert.match(html, /disabled="">Confirm move-in/);
  assert.doesNotMatch(html, /name="handoverConfirmed"|Send lease for signature/);
});

