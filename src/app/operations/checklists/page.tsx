import { requirePermission } from "@/lib/auth-guards";
import { OperationalChecklists } from "@/components/operational-checklists";

export const metadata = { title: "Checklists & padlocks" };
export default async function Page() {
  await requirePermission("operations.view");
  return <OperationalChecklists />;
}
