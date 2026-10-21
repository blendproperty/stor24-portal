import "@/styles/tenant-portal.css";
import {CustomerBookingPriceReview} from "@/components/customer-booking-price-review";
export const metadata={title:"Review your quote | My STOR24",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function BookingPriceReview({searchParams}:{searchParams:Promise<{reference?:string;proposal?:string}>}){const query=await searchParams;return <CustomerBookingPriceReview reference={typeof query.reference==="string"?query.reference.slice(0,80):""} id={typeof query.proposal==="string"?query.proposal.slice(0,100):""}/>;}
