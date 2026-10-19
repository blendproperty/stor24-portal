import { ReceiptReallocationWorkspace } from "@/components/receipt-reallocation-workspace";
import { receiptCorrectionScope } from "@/lib/receipt-reallocation-access";
export const metadata = { title: "Receipt correction training" };
export default async function ReceiptTrainingPage() {
  await receiptCorrectionScope();
  return <section data-receipt-correction-training><ReceiptReallocationWorkspace training /></section>;
}
