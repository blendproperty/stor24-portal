import { ReservationsWorkspace } from "@/components/reservations-workspace";
import {reservationPriceScope} from "@/lib/reservation-price-api";
import { requirePermission } from "@/lib/auth-guards";

export const metadata = { title: "Reservations" };
export default async function ReservationsPage({searchParams}: {searchParams: Promise<{customer?: string}>}) { const params=await searchParams; await requirePermission("reservations.manage"); let canReviewPrices=false;try{await reservationPriceScope();canReviewPrices=true;}catch(error){if(!(error instanceof Error)||error.message!=="FORBIDDEN")throw error;}return <ReservationsWorkspace initialCustomerId={params.customer} canReviewPrices={canReviewPrices}/>; }
