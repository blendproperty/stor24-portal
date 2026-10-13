import {requirePermissionScope} from "@/lib/scope";
import {CollectionNoticeWorkspace} from "@/components/collection-notice-workspace";
import "@/styles/collection-notices.css";
export const dynamic="force-dynamic";
export const metadata={title:"Collection email notices"};
export default async function Page(){await requirePermissionScope("collections.view");return <CollectionNoticeWorkspace/>}
