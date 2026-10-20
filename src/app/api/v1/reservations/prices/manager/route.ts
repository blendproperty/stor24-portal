import {cookies} from "next/headers";
import {sessionCookieName} from "@/lib/session";
import {priceApprovalCodeHash} from "@/lib/price-manager-policy";
import {z} from "zod";
import {requirePermission} from "@/lib/auth-guards";
import {sameOrigin} from "@/lib/request-security";
import {boundedPriceJson,priceHeaders,reservationPriceError,reservationPriceScope} from "@/lib/reservation-price-api";
import {priceManagerRequestSchema,priceManagerVerifySchema} from "@/lib/price-manager-policy";
import {priceManagerOptions,requestManagerPriceApproval,verifyManagerPriceApproval} from "@/lib/price-manager-service";
const schema=z.discriminatedUnion("action",[priceManagerRequestSchema.extend({action:z.literal("request")}),priceManagerVerifySchema.extend({action:z.literal("verify")})]);
export async function GET(request:Request){try{const query=z.object({facilityId:z.string().min(1).max(100)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));const scope=await reservationPriceScope("reservation_prices.propose",query.facilityId);return Response.json({data:await priceManagerOptions(scope,query.facilityId)},{headers:priceHeaders});}catch(error){return reservationPriceError(error);}}
export async function POST(request:Request){try{await requirePermission("reservation_prices.view");if(!sameOrigin(request))throw Error("FORBIDDEN");const {action,...input}=schema.parse(await boundedPriceJson(request));const scope=await reservationPriceScope("reservation_prices.propose",input.facilityId);const token=(await cookies()).get(sessionCookieName)?.value;if(!token)throw Error("UNAUTHENTICATED");const sessionHash=priceApprovalCodeHash("session",token);const data=action==="request"?await requestManagerPriceApproval(scope,input,sessionHash):await verifyManagerPriceApproval(scope,input,sessionHash);return Response.json({data},{headers:priceHeaders});}catch(error){return reservationPriceError(error);}}
