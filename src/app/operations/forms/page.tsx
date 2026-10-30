import { requirePermission } from "@/lib/auth-guards";
import { OperationalForms } from "@/components/operational-forms";
export const metadata = { title: "Operational forms" };
export default async function Page() {
  await requirePermission("operations.view");
  return <OperationalForms />;
}
