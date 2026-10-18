import { requirePermissionScope } from "@/lib/scope";
import { CollectionPhoneWorkspace } from "@/components/collection-phone-workspace";
import "@/styles/collection-notices.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reviewed SMS & WhatsApp reminders" };
export default async function Page() { await requirePermissionScope("collections.view"); return <CollectionPhoneWorkspace/>; }
