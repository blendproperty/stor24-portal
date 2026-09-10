import { mkdir, writeFile } from "node:fs/promises";
import { tenantWelcomeMessage } from "../src/lib/tenant-welcome-email";

// Synthetic preview only: never sends email or queries customer records.
process.env.APP_URL = "https://stor24-site.srv938083.hstgr.cloud";
async function main() {
  await mkdir("output/tenant-welcome", { recursive: true });
  await writeFile("output/tenant-welcome/preview.html", tenantWelcomeMessage("Brett", "stor24", "preview@example.invalid").html);
}
void main();
