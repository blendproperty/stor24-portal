type Footprint = { id: string; x: number; y: number; width: number; height: number };
export type FacadeSegment = { start: number; end: number };

/** Visible portions of the bottom edge, measured relative to the unit's x. */
export function exposedFacadeSegments(unit: Footprint, units: Footprint[]): FacadeSegment[] {
  const bottom = unit.y + unit.height;
  const blocked = units.flatMap((candidate) => {
    const gap = candidate.y - bottom;
    if (candidate.id === unit.id || gap < 0 || gap >= 26) return [];
    const start = Math.max(0, candidate.x - unit.x);
    const end = Math.min(unit.width, candidate.x + candidate.width - unit.x);
    return end > start ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start);

  const visible: FacadeSegment[] = [];
  let cursor = 0;
  for (const segment of blocked) {
    if (segment.start > cursor) visible.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < unit.width) visible.push({ start: cursor, end: unit.width });
  return visible;
}
