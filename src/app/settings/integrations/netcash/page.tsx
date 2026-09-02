import { NetcashIntegrationWorkspace } from "@/components/netcash-integration-workspace";
import { requirePermissionScope } from "@/lib/scope";

export const metadata = { title: "Netcash test connection" };
export const dynamic = "force-dynamic";

export default async function NetcashIntegrationPage() {
  await requirePermissionScope("integrations.view");
  return <NetcashIntegrationWorkspace />;
}
