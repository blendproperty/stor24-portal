import { floorKey } from "./floor-availability";
export type ProductLine = "STORAGE" | "MICRO_WAREHOUSE";
export function productLineFromRequest(request: Request): ProductLine | null {
 const value = new URL(request.url).searchParams.get("useType") ?? "STORAGE";
 return value === "STORAGE" || value === "MICRO_WAREHOUSE" ? value : null;
}
export function effectiveUseTypes(unit: { useTypesOverride?: string[]; unitType: { useTypes?: string[] } }) {
 return unit.useTypesOverride?.length ? unit.useTypesOverride : unit.unitType.useTypes ?? ["STORAGE"];
}
export function unitSupportsProduct(unit: { floor?: string | null; mapElements?: { map: { name: string } }[]; useTypesOverride?: string[]; unitType: { useTypes?: string[] } }, product: ProductLine) {
 if (!effectiveUseTypes(unit).includes(product)) return false;
 if (product === "STORAGE") return true;
 const floors = [unit.floor, ...(unit.mapElements ?? []).map(e => e.map.name)].filter(Boolean);
 return floors.length > 0 && floors.every(f => floorKey(f) === "ground floor");
}
