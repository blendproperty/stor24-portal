import { requireSession } from "@/lib/auth-guards";
import { trainingAccess } from "@/lib/move-in-training";
import { db } from "@/lib/db";
import { MoveInTraining } from "@/components/move-in-training";
export const metadata = { title:"Move-in training" };
export default async function TrainingPage() {
  const auth=await requireSession();
  await trainingAccess(db,auth.user.id);
  return <MoveInTraining/>;
}
