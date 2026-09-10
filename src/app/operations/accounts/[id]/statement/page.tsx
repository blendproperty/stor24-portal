import { AccountStatementWorkspace } from "@/components/account-statement-workspace";
import { requirePermission } from "@/lib/auth-guards";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("ledger.view");
  const { id } = await params;
  return <AccountStatementWorkspace accountId={id} />;
}
