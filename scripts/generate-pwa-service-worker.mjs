import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(repositoryRoot, "src/pwa/service-worker-template.js");
const outputPath = resolve(repositoryRoot, "public/sw.js");
const deploymentVersion =
  process.env.GITHUB_SHA ??
  process.env.SOURCE_VERSION ??
  `${new Date().toISOString()}-${randomUUID()}`;

const template = await readFile(templatePath, "utf8");
const serviceWorker = template.replaceAll("__BUILD_VERSION__", deploymentVersion);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serviceWorker, "utf8");

console.log(`Generated PWA service worker for ${deploymentVersion.slice(0, 12)}`);
