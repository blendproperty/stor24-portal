import { createHash } from "node:crypto";
type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  mapId: string;
};
export function adjacentUnitBounds(a: Rect, b: Rect) {
  if (a.mapId !== b.mapId || a.rotation !== 0 || b.rotation !== 0)
    throw new Error("Select unrotated units on the same saved floor map.");
  const near = (x: number, y: number) => Math.abs(x - y) <= 3;
  const horizontal =
    near(a.y, b.y) &&
    near(a.height, b.height) &&
    (near(a.x + a.width, b.x) || near(b.x + b.width, a.x));
  const vertical =
    near(a.x, b.x) &&
    near(a.width, b.width) &&
    (near(a.y + a.height, b.y) || near(b.y + b.height, a.y));
  if (!horizontal && !vertical)
    throw new Error(
      "The saved map does not confirm a full shared boundary between these units.",
    );
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
export function combinationToken(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
