import { requireSession } from "@/lib/auth-guards";
import { trainingDebtors } from "@/lib/training-debtor-service";
import { TrainingDebtorWorkspace } from "@/components/training-debtor-workspace";
export const metadata = { title: "Training customer balances" };
export const dynamic = "force-dynamic";
export default async function TrainingDebtorPage() {
  const auth = await requireSession();
  return <TrainingDebtorWorkspace initial={await trainingDebtors(auth.user.id)}/>;
}
