import { requirePermissionScope } from "@/lib/scope";
import { CollectionSchedules } from "@/components/collection-schedules";
export const dynamic = "force-dynamic";
export const metadata = { title: "Scheduled collection letters" };
export default async function Page() { await requirePermissionScope("collection_schedules.view"); return <CollectionSchedules/>; }
