import {requireOwner} from "@/lib/auth-guards";
import {sameOrigin} from "@/lib/request-security";
import {boundedPriceJson,priceHeaders,reservationPriceError} from "@/lib/reservation-price-api";
import {staffPriceContact,saveStaffPriceContact} from "@/lib/price-manager-service";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{const auth=await requireOwner();return Response.json({data:await staffPriceContact(auth.user.organisationId,(await context.params).id)},{headers:priceHeaders});}catch(error){return reservationPriceError(error);}}
export async function POST(request:Request,context:Context){try{const auth=await requireOwner();if(!sameOrigin(request))throw Error("FORBIDDEN");const data=await saveStaffPriceContact(auth.user.organisationId,auth.user.id,(await context.params).id,await boundedPriceJson(request));return Response.json({data},{headers:priceHeaders});}catch(error){return reservationPriceError(error);}}
