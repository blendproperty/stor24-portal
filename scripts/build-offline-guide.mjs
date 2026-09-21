import { build } from "esbuild";
await build({ entryPoints: ["src/pwa/offline-guided-help.ts"], outfile: "public/offline-guided-help.js", bundle: true, minify: true, format: "iife", target: "es2020" });
