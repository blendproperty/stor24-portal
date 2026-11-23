import { build as esbuild } from "esbuild";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Bundled Prisma needs its file URL when a route fixture executes as CommonJS.
export const build: typeof esbuild = options => esbuild({ ...options, define: { ...options.define, "import.meta.url": JSON.stringify(pathToFileURL(resolve("src/generated/prisma/client.ts")).href) } });
