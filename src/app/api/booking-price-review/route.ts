import {z} from "zod";
import {sameOrigin,privacyHash,requestIp,rateLimit} from "@/lib/request-security";
import {boundedPriceJson,priceHeaders,reservationPriceError} from "@/lib/reservation-price-api";
import {reservationPriceAcceptanceSchema} from "@/lib/reservation-price-policy";
import {reservationPriceVerificationAvailable,previewCustomerReservationPrice,acceptCustomerReservationPrice,appliedCustomerReservationPrice} from "@/lib/reservation-price-service";
import {startPublicEmailVerification,verifyPublicReservationEmail} from "@/lib/public-booking-service";
import {preparePublicReservationLease} from "@/lib/public-lease-workflow";

const base=z.object({reference:z.string().trim().min(1).max(80),id:z.string().min(1).max(100)});
const access=base.extend({identityAccessToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
const input=z.discriminatedUnion("action",[
  base.extend({action:z.literal("request-code")}).strict(),
  base.extend({action:z.literal("verify"),code:z.string().regex(/^\d{6}$/)}).strict(),
  access.extend({action:z.literal("preview")}).strict(),
  reservationPriceAcceptanceSchema.extend({action:z.literal("accept")}).strict(),
  access.extend({action:z.literal("agreement"),paymentMethod:z.enum(["CARD","EFT"])}).strict(),
]);
export async function POST(request:Request){try{
  if(!sameOrigin(request))throw Error("FORBIDDEN");
  const parsed=input.safeParse(await boundedPriceJson(request));if(!parsed.success)return Response.json({error:{message:"Check your booking review and confirmation."}},{status:422,headers:priceHeaders});
  const body=parsed.data;
  const maximum=body.action==="request-code"?5:body.action==="verify"?15:40;
  if(await rateLimit(`booking-price:${body.action}:${privacyHash(requestIp(request))}`,maximum,15*60*1000))return Response.json({error:{message:"Too many attempts. Please wait before retrying."}},{status:429,headers:priceHeaders});
  if(body.action==="request-code"||body.action==="verify"){
    await reservationPriceVerificationAvailable(body.reference,body.id);
    const result=body.action==="request-code"?await startPublicEmailVerification(body.reference,true):await verifyPublicReservationEmail(body.reference,body.code);
    if(!result.ok)return Response.json({error:{message:"The code could not be confirmed or delivered. Check the code or contact the store."}},{status:409,headers:priceHeaders});
    return Response.json({data:result},{headers:priceHeaders});
  }
  if(body.action==="preview")return Response.json({data:await previewCustomerReservationPrice(body.reference,body.identityAccessToken,body.id)},{headers:priceHeaders});
  if(body.action==="accept"){const {action,...acceptance}=body;void action;return Response.json({data:await acceptCustomerReservationPrice(acceptance)},{headers:priceHeaders});}
  await appliedCustomerReservationPrice(body.reference,body.identityAccessToken,body.id);
  const agreement=await preparePublicReservationLease(body.reference,body.paymentMethod);
  if(!agreement.ok)return Response.json({error:{message:"Your quote is saved. The agreement still needs identity or booking review; contact the store."}},{status:409,headers:priceHeaders});
  return Response.json({data:{url:`/sign/${agreement.token}`,status:agreement.status}},{headers:priceHeaders});
}catch(error){return reservationPriceError(error);}}
