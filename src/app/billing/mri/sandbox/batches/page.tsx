import { requirePermissionScope } from "@/lib/scope";
import { MriBatchWorkspace } from "@/components/mri-batch-workspace";
import "@/styles/mri-mapping.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "MRI sandbox journal batches" };
export default async function Page() {
  const scope = await requirePermissionScope("mri.view");
  if (!scope.unrestrictedFacilities) return <p>Organisation-wide MRI permission is required.</p>;
  return <MriBatchWorkspace />;
}
