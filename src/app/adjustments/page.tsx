import { PageHeader } from "@/components/page-header";
import { AdjustmentsWorkspace } from "@/components/adjustments-workspace";
import { requirePermissionScope } from "@/lib/scope";

export const metadata = { title: "Adjustments" };

export default async function AdjustmentsPage() {
  await requirePermissionScope("adjustments.view");
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Controlled corrections"
        title="Adjustments"
        description="Correct financial and inventory exceptions through reason-coded reversals, approvals and permanent audit history."
      />
      <AdjustmentsWorkspace />
    </div>
  );
}

