export const MIDRAND_MARKET_RATE_VERSION = "MIDRAND_2026_08_V1";

const roundToNearest50 = (value: number) => Math.round(value / 50) * 50;

/**
 * Mid-market asking rent derived from the August 2026 Gauteng competitor
 * benchmark. The curve anchors 5 m² at R1,000 and tapers the marginal R/m²
 * as units get larger. Upper floors receive the common access discount seen
 * in the advertised evidence. This changes standard unit rates only; active
 * occupancy rents and existing reservation quotes remain unchanged.
 */
export function recommendedMidrandMonthlyRate(areaSqMetres: number, floor?: string | null) {
  if (!Number.isFinite(areaSqMetres) || areaSqMetres <= 0) throw new Error("AREA_REQUIRED");

  let base: number;
  if (areaSqMetres <= 5) base = 400 + areaSqMetres * 120;
  else if (areaSqMetres <= 10) base = 1_000 + (areaSqMetres - 5) * 110;
  else if (areaSqMetres <= 20) base = 1_550 + (areaSqMetres - 10) * 100;
  else if (areaSqMetres <= 36) base = 2_550 + (areaSqMetres - 20) * 90;
  else base = 3_990 + (areaSqMetres - 36) * 65;

  const normalizedFloor = (floor ?? "").toLowerCase();
  const floorFactor = normalizedFloor.includes("second")
    ? 0.85
    : normalizedFloor.includes("first")
      ? 0.9
      : 1;
  return roundToNearest50(base * floorFactor);
}
