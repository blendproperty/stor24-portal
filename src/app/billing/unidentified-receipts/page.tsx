import { PageHeader } from "@/components/page-header";
import { UnidentifiedReceiptWorkspace } from "@/components/unidentified-receipt-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Unidentified payment review" };
export default async function UnidentifiedReceiptsPage() {
  await requirePermissionScope("receipt_review.view");
  return <div className="page-stack"><PageHeader eyebrow="Finance investigation" title="Unidentified payment review" description="Retain original evidence, suggest an account and obtain an independent matching review."/><UnidentifiedReceiptWorkspace/></div>;
}
