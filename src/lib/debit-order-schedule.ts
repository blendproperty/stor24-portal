import { publicInitialRent, publicCheckoutTotal } from "./public-initial-rent";
import { parseDebitOrderPreferences } from "./debit-order-preferences";

type Booking = Parameters<typeof publicCheckoutTotal>[0];
export function debitOrderSchedule(booking: Booking, input: unknown, today: string, allowedDays?: number[]) {
  let initialPayment: { lines: { period: string; amount: number }[]; goods: number; total: number } | null = null;
  let earliestDate = today;
  try {
    const rent = publicInitialRent(booking);
    // Legacy/staff leases do not prove which periods the initial invoice covers.
    if (!rent.lines.length) throw new Error("MANDATE_INITIAL_RENT_REVIEW_REQUIRED");
    initialPayment = { lines: rent.lines, goods: Number(booking.packageSelection?.priceSnapshot ?? 0), total: publicCheckoutTotal(booking) };
    const lastPeriod = rent.lines[rent.lines.length - 1].period;
    const next = new Date(`${lastPeriod}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    earliestDate = next.toISOString().slice(0, 10) > today ? next.toISOString().slice(0, 10) : today;
  } catch {
    return { initialPayment: null, earliestDate: null, suggestedDate: null, ready: false, code: "MANDATE_INITIAL_RENT_REVIEW_REQUIRED", message: "STOR24 must confirm the initial invoice and covered rental months before arranging recurring collections." };
  }
  const day = allowedDays?.[0] ?? 1;
  let suggestedDate = `${earliestDate.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  if (suggestedDate < earliestDate) {
    const next = new Date(`${earliestDate.slice(0, 7)}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    suggestedDate = `${next.toISOString().slice(0, 7)}-${String(day).padStart(2, "0")}`;
  }
  const preferences = parseDebitOrderPreferences(input, earliestDate);
  const ready = !!preferences && Number(preferences.firstCollectionDate.slice(8)) === preferences.collectionDay && (!allowedDays || (allowedDays.includes(preferences.collectionDay) && preferences.firstCollectionDate.slice(0, 4) === today.slice(0, 4)));
  return { initialPayment, earliestDate, suggestedDate, ready, code: ready ? null : "MANDATE_SCHEDULE_REVIEW_REQUIRED", message: ready ? null : `Choose matching first and monthly collection days on or after ${earliestDate}, after the rental months included in your first payment.${allowedDays ? " The current Netcash mandate also requires an approved debit day in this calendar year; contact STOR24 for a later year." : ""}` };
}
