import { TenantPortal } from "@/components/tenant-portal";
import "@/styles/tenant-portal.css";
import "@/styles/tenant-shop.css";
import "@/styles/tenant-dashboard.css";

export const metadata = { title: "My STOR24", robots: { index: false, follow: false } };
export default async function MyStor24({ searchParams }: { searchParams: Promise<{ organisation?: string; account?: string; from?: string; to?: string; booking?: string; step?: string }> }) {
  const params = await searchParams;
  return <TenantPortal organisation={params.organisation ?? process.env.TENANT_PORTAL_ORGANISATION_SLUG ?? ""} initialAccount={params.account} initialFrom={params.from} initialTo={params.to} initialBooking={typeof params.booking === "string" && params.booking.length <= 160 ? params.booking : undefined} prepareForMoveIn={params.step === "access-photo"} />;
}
