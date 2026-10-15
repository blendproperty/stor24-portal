import { ReceiptReallocationWorkspace } from "@/components/receipt-reallocation-workspace";
import { receiptCorrectionScope } from "@/lib/receipt-reallocation-access";

export const metadata = { title: "Receipt allocation corrections" };

export default async function ReceiptCorrectionsPage() {
  await receiptCorrectionScope();
  return <section data-receipt-correction><ReceiptReallocationWorkspace /></section>;
}
