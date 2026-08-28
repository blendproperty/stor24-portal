import { InsuranceWorkspace } from "@/components/insurance-workspace";
import { requirePermission } from "@/lib/auth-guards";

export const metadata = { title: "Insurance" };

export default async function InsurancePage() {
  await requirePermission("operations.view");
  return <InsuranceWorkspace />;
}
