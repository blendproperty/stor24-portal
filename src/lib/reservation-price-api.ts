import {requirePermission} from "./auth-guards";
import {apiError} from "./api";
import type {RequestScope} from "./scope";

export const priceHeaders={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function boundedPriceJson(request:Request){
  const reader=request.body?.getReader();if(!reader)throw Error("PRICE_INVALID");
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>16384){await reader.cancel();throw Error("PRICE_REQUEST_LIMIT");}chunks.push(next.value);}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Error("PRICE_INVALID");}
}
export async function reservationPriceScope(action="reservation_prices.view",facilityId?:string):Promise<RequestScope>{
  const required=[...new Set(["reservation_prices.view","reservations.manage","billing.view",action])];
  let facilities:string[]|null=null,userId="",organisationId="";
  for(const permission of required){const auth=await requirePermission(permission,facilityId);if(userId&&(userId!==auth.user.id||organisationId!==auth.organisationId))throw Error("UNAUTHENTICATED");userId=auth.user.id;organisationId=auth.organisationId;if(auth.allowedFacilityIds!==null)facilities=facilities===null?auth.allowedFacilityIds:facilities.filter(id=>auth.allowedFacilityIds!.includes(id));}
  if(facilities!==null&&!facilities.length)throw Error("FORBIDDEN");
  return {userId,organisationId,facilityIds:facilities??[],unrestrictedFacilities:facilities===null};
}
export function reservationPriceError(error:unknown){
  const code=error instanceof Error?error.message:"";
  const messages:Record<string,string>={PRICE_INVALID:"Check the quote review request.",PRICE_REQUEST_LIMIT:"This quote request is too large.",PRICE_REVIEW_REQUIRED:"The booking needs finance, agreement or source review before its price can change.",PRICE_SOURCE_CHANGED:"The original booking changed. Reload and prepare a new proposal.",PRICE_ORIGINAL_REVIEW_REQUIRED:"The retained original quote needs review. No price was changed.",PRICE_PENDING_EXISTS:"Review or withdraw the existing proposal before preparing another.",PRICE_UNCHANGED:"Enter a monthly quote different from the saved price.",PRICE_EXPIRED:"This proposal expired or is no longer available.",PRICE_INDEPENDENT_REVIEW_REQUIRED:"A different authorised colleague must review this proposal.",PRICE_FRESH_VERIFICATION_REQUIRED:"Verify this booking's email again after approval before reviewing the quote.",PRICE_GOVERNED_WORKFLOW_REQUIRED:"Use the booking price review workflow to change saved online particulars. Signed or paid bookings require finance review."};
  if(messages[code])return Response.json({error:{code,message:messages[code]}},{status:code==="PRICE_REQUEST_LIMIT"?413:code==="PRICE_FRESH_VERIFICATION_REQUIRED"?401:code==="PRICE_INVALID"?422:409,headers:priceHeaders});
  const response=apiError(error);for(const [key,value]of Object.entries(priceHeaders))response.headers.set(key,value);return response;
}
