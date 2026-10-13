import { requirePermissionScope } from "@/lib/scope";
import { MriSandboxWorkspace } from "@/components/mri-sandbox-workspace";
import "@/styles/mri-mapping.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "MRI sandbox testing" };
export default async function MriSandboxPage() {
  const scope = await requirePermissionScope("mri.view");
  if (!scope.unrestrictedFacilities) return <p>Organisation-wide MRI permission is required.</p>;
  return <MriSandboxWorkspace />;
}
