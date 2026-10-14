import { requirePermissionScope } from "@/lib/scope";
import { CollectionNoticeBatchWorkspace } from "@/components/collection-notice-batch-workspace";
import "@/styles/collection-notices.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Prepare collection email audience" };
export default async function Page() {
  await requirePermissionScope("collections.manage");
  return <CollectionNoticeBatchWorkspace/>;
}
