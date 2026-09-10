/** Synthetic layout fixture only. Never reads customer data. */
import { mkdir, writeFile } from "node:fs/promises";
import { renderTenantDocumentPdf } from "../src/lib/finance/tenant-document-pdf";

async function main() {
  const bytes = await renderTenantDocumentPdf({ title: "Account statement", reference: "LAYOUT-PREVIEW-NOT-A-CUSTOMER", customerName: "Sample Tenant", subtitle: "01 Sep 2026 to 30 Sep 2026 | Sample store", columns: ["Date", "Description", "Debit", "Credit", "Balance"], rows: [["", "Opening balance", "", "", "ZAR 0.00"], ...Array.from({ length: 70 }, (_, i) => ["10 Sep 2026", `Sample transaction ${i + 1}${i % 7 === 0 ? " - extended description to exercise wrapping" : ""}`, "ZAR 100.00", "-", `ZAR ${(i + 1) * 100}.00`]), ["", "Closing balance", "", "", "ZAR 7000.00"]], notes: ["SYNTHETIC LAYOUT PREVIEW ONLY. Not a customer statement.", "Negative balances are account credits. This document is not a tax invoice or bank settlement confirmation."] });
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/tenant-statement-preview.pdf", bytes);
  console.log("output/pdf/tenant-statement-preview.pdf");
}
void main();
