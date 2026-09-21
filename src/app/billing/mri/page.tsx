import { requirePermissionScope } from "@/lib/scope";
import { MriWorkspace } from "@/components/mri-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "MRI accounting" };
export default async function MriPage() {
  const scope = await requirePermissionScope("mri.view");
  if (!scope.unrestrictedFacilities) return <p>Organisation-wide MRI permission is required.</p>;
  return <MriWorkspace />;
}
