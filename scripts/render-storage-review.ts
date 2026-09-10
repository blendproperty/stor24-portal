// Generates a clearly synthetic legal-review layout sample, not a customer signature.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderReviewLeaseDocument } from "../src/lib/storage-terms";
import { renderSignedLeasePdf } from "../src/lib/public-lease-pdf";

async function main() {
  const content = "LAYOUT SAMPLE ONLY - NOT A SIGNED CUSTOMER AGREEMENT\n" + renderReviewLeaseDocument({ facilityName: "Store 1 - Midpoint", unitNumber: "SAMPLE", unitTypeName: "6 square metres", customerName: "Sample customer for legal review", monthlyRate: 1550, startDate: new Date("2026-09-30T00:00:00Z"), paymentMethod: "DEBIT_ORDER", storagePackage: { name: "Example moving package", priceZar: 649, contents: "5 x Small Moving Box, 5 x Medium Moving Box, 1 x Packing Tape, 1 x Permanent Marker" } });
  const pdf = await renderSignedLeasePdf({ content, reference: "ST24-LEGAL-REVIEW-SAMPLE", paymentMethod: "DEBIT_ORDER", signerName: "SAMPLE ONLY - NOT SIGNED", signedAt: new Date("2026-09-10T10:00:00Z"), sha256: createHash("sha256").update(content).digest("hex") });
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/stor24-agreement-legal-review-sample.pdf", pdf);
}
void main();
