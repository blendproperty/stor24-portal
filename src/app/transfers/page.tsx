import { AccountsWorkspace } from "@/components/accounts-workspace";
import { requirePermission } from "@/lib/auth-guards";

export const metadata = { title: "Transfers" };
export default async function TransfersPage() {
  await requirePermission("ledger.view");
  return <AccountsWorkspace transferMode/>;
}
