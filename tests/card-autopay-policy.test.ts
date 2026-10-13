import assert from "node:assert/strict";
import test from "node:test";
import { cardAutopayPeriods, fixedCardAutopayAmount, cardAutopayProviderFields, cardAutopayRequestText } from "../src/lib/payments/card-autopay-policy";
const now = new Date("2026-10-13T10:00:00+02:00");
test("fixed monthly schedules cross December without catch-up or an invented infinite cycle", () => {
  assert.deepEqual(cardAutopayPeriods({ startDate: "2026-12-01", cycles: 3 }, now), ["2026-12", "2027-01", "2027-02"]);
  for (const startDate of ["2026-10-01", "2026-09-01", "2026-11-30", "2026-02-30"]) assert.throws(() => cardAutopayPeriods({ startDate, cycles: 12 }, now));
  for (const cycles of [0, -1, 1000, 1.5]) assert.throws(() => cardAutopayPeriods({ startDate: "2026-11-01", cycles }, now));
});
test("fixed amount rejects scheduled discounts/rate changes, non-finite or zero rent", () => {
  assert.equal(fixedCardAutopayAmount([950, 950, 950]), "950.00");
  for (const amounts of [[950, 1000], [0], [-1], [NaN], [Infinity], []]) assert.throws(() => fixedCardAutopayAmount(amounts));
});
test("documented provider fields keep invoice amount separate from recurring rent and contain no token", () => {
  assert.deepEqual(cardAutopayProviderFields({ reference: "CARD-123", approvedInitialInvoiceAmount: 980.65, recurringAmount: 950, schedule: { startDate: "2026-11-01", cycles: 12 } }, now), { p2: "CARD-123", p4: "980.65", m14: "1", m16: "1", m17: "12", m18: "1", m19: "2026-11-01", m20: "950.00" });
  assert.throws(() => cardAutopayProviderFields({ reference: "CARD-123", approvedInitialInvoiceAmount: 0, recurringAmount: 950, schedule: { startDate: "2026-11-01", cycles: 12 } }, now));
  assert.throws(() => cardAutopayProviderFields({ reference: "too-long-reference-value-1234567890", approvedInitialInvoiceAmount: 10, recurringAmount: 950, schedule: { startDate: "2026-11-01", cycles: 12 } }, now));
});
test("request wording states the fixed amount, duration and no-money boundary", () => {
  const text = cardAutopayRequestText("950.00", { startDate: "2026-11-01", cycles: 12 });
  assert.match(text, /R950.00/); assert.match(text, /12 payments/); assert.match(text, /does not schedule or collect any money/);
});

