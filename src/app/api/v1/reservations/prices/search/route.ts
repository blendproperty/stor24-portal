import {z} from "zod";
import {priceHeaders,reservationPriceScope,reservationPriceError} from "@/lib/reservation-price-api";
import {searchReservationPrices} from "@/lib/reservation-price-search";
const querySchema=z.object({query:z.string().trim().min(2).max(100),page:z.coerce.number().int().min(0).max(100).default(0)}).strict();
export async function GET(request:Request){
  try{
    const scope=await reservationPriceScope();
    const parsed=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)throw Error("PRICE_INVALID");
    return Response.json({data:await searchReservationPrices(scope,parsed.data.query,parsed.data.page)},{headers:priceHeaders});
  }catch(error){return reservationPriceError(error);}
}
