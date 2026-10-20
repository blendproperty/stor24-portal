import {z} from "zod";
import {requirePermission} from "@/lib/auth-guards";
import {sameOrigin} from "@/lib/request-security";
import {boundedPriceJson,priceHeaders,reservationPriceError,reservationPriceScope} from "@/lib/reservation-price-api";
import {reservationPriceSendSchema,reservationPricePreparationSchema,reservationPriceProposalSchema,reservationPriceDecisionSchema} from "@/lib/reservation-price-policy";
import {sendReservationPriceReview,prepareStaffReservationQuote,proposeReservationPrice,decideReservationPrice,reservationPriceWorkspace} from "@/lib/reservation-price-service";

const actions=z.discriminatedUnion("action",[reservationPriceSendSchema.extend({action:z.literal("send")}),reservationPricePreparationSchema.extend({action:z.literal("prepare")}),reservationPriceProposalSchema.extend({action:z.literal("propose")}),reservationPriceDecisionSchema.extend({action:z.literal("decide")})]);
export async function GET(request:Request){try{
  const scope=await reservationPriceScope();const query=z.object({reference:z.string().trim().min(1).max(100)}).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!query.success)throw Error("PRICE_INVALID");
  const data=await reservationPriceWorkspace(scope,query.data.reference);
  const allowed=async(permission:string)=>{try{await requirePermission(permission,data.reservation.facilityId);return true;}catch(error){if(error instanceof Error&&error.message.includes("FORBIDDEN"))return false;throw error;}};
  return Response.json({data:{...data,canPropose:await allowed("reservation_prices.propose"),canApprove:await allowed("reservation_prices.approve"),canSend:await allowed("reservation_prices.propose")&&await allowed("operations.manage")}},{headers:priceHeaders});
}catch(error){return reservationPriceError(error);}}
export async function POST(request:Request){try{
  await requirePermission("reservation_prices.view");if(!sameOrigin(request))throw Error("FORBIDDEN");
  const parsed=actions.safeParse(await boundedPriceJson(request));if(!parsed.success)return Response.json({error:{message:"Check the quote amount, reason and explicit confirmation."}},{status:422,headers:priceHeaders});
  const {action,...input}=parsed.data;
  const permission=action==="send"||action==="prepare"||action==="propose"||("decision" in input&&input.decision==="WITHDRAWN")?"reservation_prices.propose":"reservation_prices.approve";
  const scope=await reservationPriceScope(permission,input.facilityId);
  if(action==="send")await requirePermission("operations.manage",input.facilityId);
  const data=action==="send"?await sendReservationPriceReview(scope,input):action==="prepare"?await prepareStaffReservationQuote(scope,input):action==="propose"?await proposeReservationPrice(scope,reservationPriceProposalSchema.parse(input)):await decideReservationPrice(scope,reservationPriceDecisionSchema.parse(input));
  return Response.json({data},{headers:priceHeaders});
}catch(error){return reservationPriceError(error);}}
