import { TenantPortal } from "@/components/tenant-portal";
import "@/styles/tenant-portal.css";

export const metadata = { title: "My STOR24", robots: { index: false, follow: false } };
export default async function MyStor24({ searchParams }: { searchParams: Promise<{ organisation?: string; account?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  return <TenantPortal organisation={params.organisation ?? process.env.TENANT_PORTAL_ORGANISATION_SLUG ?? ""} initialAccount={params.account} initialFrom={params.from} initialTo={params.to} />;
}
