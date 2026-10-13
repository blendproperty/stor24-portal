import { requirePermissionScope } from "@/lib/scope";
import { MriMappingWorkspace } from "@/components/mri-mapping-workspace";
import "@/styles/mri-mapping.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "MRI finance mappings" };
export default async function MriMappingPage() {
  const scope = await requirePermissionScope("mri.view");
  if (!scope.unrestrictedFacilities) return <p>Organisation-wide MRI permission is required.</p>;
  return <MriMappingWorkspace />;
}
