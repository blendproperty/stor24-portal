import { ReservationsWorkspace } from "@/components/reservations-workspace";
import { requirePermission } from "@/lib/auth-guards";

export const metadata = { title: "Reservations" };
export default async function ReservationsPage({searchParams}: {searchParams: Promise<{customer?: string}>}) { const params=await searchParams; await requirePermission("reservations.manage"); return <ReservationsWorkspace initialCustomerId={params.customer}/>; }
