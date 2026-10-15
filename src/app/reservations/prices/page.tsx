import {ReservationPriceWorkspace} from "@/components/reservation-price-workspace";
import {reservationPriceScope} from "@/lib/reservation-price-api";
export const metadata={title:"Booking price review"};
export default async function BookingPricePage({searchParams}:{searchParams:Promise<{reference?:string}>}){await reservationPriceScope();const query=await searchParams;return <ReservationPriceWorkspace initialReference={typeof query.reference==="string"?query.reference.slice(0,100):""}/>;}
