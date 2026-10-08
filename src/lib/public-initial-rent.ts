import { initialRentPreview } from './proration-preview';
import { southAfricaDateKey } from './south-africa-time';

export const PUBLIC_INITIAL_RENT_POLICY = { mode: 'AFTER_CUTOFF_NEXT_MONTH', cutoffDay: 15 } as const;
export function newPublicInitialRent(rate: number, date: Date) {
  const moveIn = southAfricaDateKey(date);
  const calculated = initialRentPreview(rate, moveIn, PUBLIC_INITIAL_RENT_POLICY);
  if (!calculated) throw Error('INVALID_INITIAL_RENT');
  return { version: 1, moveIn, monthlyRate: rate, policy: PUBLIC_INITIAL_RENT_POLICY, lines: calculated.lines, total: calculated.total };
}
// Historical reservations retain their original price. Never silently reprice a signed booking.
export function publicInitialRent(reservation: { quotedRate: unknown; intendedMoveIn?: Date | null; initialRentSnapshot?: unknown }) {
  const rate = Number(reservation.quotedRate);
  const stored = reservation.initialRentSnapshot;
  if (stored == null) return { total: rate, lines: [] as {period:string;amount:number}[], policy: null };
  const snapshot = stored as ReturnType<typeof newPublicInitialRent>;
  if (snapshot.version !== 1 || !reservation.intendedMoveIn) throw Error('INVALID_INITIAL_RENT_SNAPSHOT');
  const expected = newPublicInitialRent(rate, reservation.intendedMoveIn);
  if (JSON.stringify(snapshot) !== JSON.stringify(expected)) {
    // JSONB does not preserve property ordering.
    if (snapshot.moveIn !== expected.moveIn || snapshot.monthlyRate !== expected.monthlyRate || snapshot.total !== expected.total || snapshot.policy?.mode !== expected.policy.mode || snapshot.policy.cutoffDay !== expected.policy.cutoffDay || !Array.isArray(snapshot.lines) || snapshot.lines.length !== expected.lines.length || snapshot.lines.some((line,index)=>line.period!==expected.lines[index].period || line.amount!==expected.lines[index].amount)) throw Error('INVALID_INITIAL_RENT_SNAPSHOT');
  }
  return expected;
}
export function publicCheckoutTotal(reservation: Parameters<typeof publicInitialRent>[0] & { packageSelection?: {priceSnapshot: unknown} | null }) {
  const amount = publicInitialRent(reservation).total + Number(reservation.packageSelection?.priceSnapshot ?? 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20_000_000) throw Error('INVALID_CHECKOUT_AMOUNT');
  return Math.round(amount * 100) / 100;
}

/** Readiness screens must show invalid saved pricing as a blocker, never reprice it. */
export function publicCheckoutReview(reservation: Parameters<typeof publicCheckoutTotal>[0]) {
  try {
    return { amount: publicCheckoutTotal(reservation), needsReview: false };
  } catch (error) {
    if (!(error instanceof Error) || !["INVALID_CHECKOUT_AMOUNT", "INVALID_INITIAL_RENT", "INVALID_INITIAL_RENT_SNAPSHOT"].includes(error.message)) throw error;
    return { amount: 0, needsReview: true };
  }
}
