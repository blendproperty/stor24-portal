import { TenantOrderStatus } from "@/components/tenant-order-status";
import "@/styles/tenant-portal.css";

export const metadata = { title: "Your order | My STOR24", robots: { index: false, follow: false } };
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantOrderStatus orderId={id} />;
}
