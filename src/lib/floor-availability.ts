/** Stable keys tolerate the existing numeric and named floor labels. */
export function floorKey(floor: string | null | undefined): string {
  const value = (floor ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (["0", "g", "gf", "ground", "ground floor", "floor 0"].includes(value)) return "ground floor";
  if (["1", "1st", "first", "first floor", "1st floor", "floor 1", "level 1"].includes(value)) return "first floor";
  if (["2", "2nd", "second", "second floor", "2nd floor", "floor 2", "level 2"].includes(value)) return "second floor";
  return value;
}

export function floorIsOperational(floor: string | null | undefined, closedFloors: readonly string[] = []) {
  return !closedFloors.some(closed => floorKey(closed) === floorKey(floor));
}

// A mapped unit cannot bypass a closed floor through a missing or stale floor label.
export const floorMapSelection = { select: { map: { select: { name: true } } } } as const;
export function unitIsOperational(unit: { floor?: string | null; mapElements?: { map: { name: string } }[] }, closedFloors: readonly string[] = []) {
  return floorIsOperational(unit.floor, closedFloors) && (unit.mapElements ?? []).every(element => floorIsOperational(element.map.name, closedFloors));
}

export function floorLabel(floor: string) {
  return floorKey(floor).replace(/\b\w/g, letter => letter.toUpperCase());
}

export function facilityFloorKeys(facility: { closedFloors?: string[]; units: { floor: string | null }[]; maps?: { name: string }[] }) {
  return [...new Set([...facility.units.map(unit => floorKey(unit.floor)), ...(facility.maps ?? []).map(map => floorKey(map.name)), ...(facility.closedFloors ?? []).map(floorKey)].filter(Boolean))]
    .sort((a, b) => {
      const ordered = ["ground floor", "first floor", "second floor"];
      return (ordered.includes(a) ? ordered.indexOf(a) : 10) - (ordered.includes(b) ? ordered.indexOf(b) : 10) || a.localeCompare(b, undefined, { numeric: true });
    });
}
