import { HikvisionIntegrationWorkspace } from "@/components/hikvision-integration-workspace";
import { requirePermissionScope } from "@/lib/scope";

export const metadata = { title: "Hikvision integration" };
export const dynamic = "force-dynamic";

export default async function HikvisionIntegrationPage() {
  await requirePermissionScope("integrations.view");
  return <HikvisionIntegrationWorkspace />;
}
