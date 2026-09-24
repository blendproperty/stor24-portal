import { readdir, readFile } from "node:fs/promises";

// Preload fixed repository assets. HTTP input never becomes a filesystem path.
export async function fixtureBrandAssets() {
  const entries = await readdir("public/brand", { withFileTypes: true });
  const assets = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry =>
    [`/brand/${entry.name}`, await readFile(new URL(`../public/brand/${entry.name}`, import.meta.url))],
  ));
  return new Map(assets);
}
