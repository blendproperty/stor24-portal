import {z} from "zod";
import {newPublicInitialRent, publicInitialRent} from "./public-initial-rent";

const id=z.string().min(1).max(100);
export const reservationPriceProposalSchema=z.object({reservationId:id,facilityId:id,requestKey:z.uuid(),monthlyRate:z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine(v=>Number(v)>0&&Number(v)<=10000000),reason:z.string().trim().min(10).max(1000)}).strict();
export const reservationPriceDecisionSchema=z.object({id,facilityId:id,revision:z.number().int().min(0),decision:z.enum(["APPROVED","REJECTED","WITHDRAWN"]),reference:z.string().trim().min(5).max(200),confirmed:z.literal(true)}).strict();
export const reservationPriceAcceptanceSchema=z.object({reference:z.string().min(1).max(80),id,identityAccessToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),quoteFingerprint:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true),understandsNewAgreementRequired:z.literal(true)}).strict();
export type ReservationPriceProposal=z.infer<typeof reservationPriceProposalSchema>;
export type ReservationPriceDecision=z.infer<typeof reservationPriceDecisionSchema>;
export type ReservationPriceAcceptance=z.infer<typeof reservationPriceAcceptanceSchema>;

type Booking={source:string;status:string;journey:string;convertedTenancyId:string|null;publicReference:string|null;quotedRate:unknown;initialRentSnapshot:unknown;intendedMoveIn:Date|null;holdExpiresAt:Date|null;contactVerifiedAt:Date|null;emailVerifiedAt:Date|null;signed:boolean;mandate:boolean;paymentSessions:number;financialActivity:boolean};
export function reservationPriceBlockers(booking:Booking,now=new Date()){
  const reasons:string[]=[];
  if(!["PUBLIC_WEBSITE","PUBLIC_WALK_IN"].includes(booking.source)||!booking.publicReference||booking.journey!=="RENTAL")reasons.push("Only an existing online rental quote is supported here.");
  if(booking.status!=="ACTIVE"||booking.convertedTenancyId)reasons.push("The booking is no longer an active unsigned quote.");
  if(!booking.holdExpiresAt||booking.holdExpiresAt<=now)reasons.push("The original reservation hold has expired.");
  if(!booking.contactVerifiedAt||!booking.emailVerifiedAt)reasons.push("The customer must complete the original contact verification.");
  if(booking.signed)reasons.push("A signed agreement requires the separate legal/finance amendment process.");
  if(booking.mandate)reasons.push("Existing payment authority requires finance review.");
  if(booking.paymentSessions||booking.financialActivity)reasons.push("Payment, invoice or ledger activity requires finance review.");
  if(!booking.intendedMoveIn||booking.initialRentSnapshot==null)reasons.push("The original saved price snapshot is unavailable.");
  else try{publicInitialRent(booking);}catch{reasons.push("The original saved price snapshot needs review.");}
  return reasons;
}
export function proposedReservationPrice(rate:string,moveIn:Date){
  const parsed=reservationPriceProposalSchema.shape.monthlyRate.parse(rate);
  return newPublicInitialRent(Number(parsed),moveIn);
}
export function requireIndependentPriceApproval(proposer:string,reviewer:string){if(proposer===reviewer)throw Error("PRICE_INDEPENDENT_REVIEW_REQUIRED");}
export const reservationPriceNotice="This changes only an unsigned booking quote after your acceptance. You must review and sign the updated agreement separately. It does not take payment, alter a signed agreement or authorise a collection.";

/** Existing generic edits must not bypass a saved online quote or signed terms. */
export function assertReservationQuotePatch(current:{status:string;convertedTenancyId:string|null;quotedRate:unknown;initialRentSnapshot:unknown;unitId:string;customerId:string;facilityId:string;intendedMoveIn:Date|null;publicLease?:{status:string}|null},patch:{quotedRate?:unknown;unitId?:string;customerId?:string;facilityId?:string;intendedMoveIn?:Date}){
  if(!current.initialRentSnapshot&&!current.convertedTenancyId&&current.status!=="CONVERTED"&&current.publicLease?.status!=="SIGNED")return;
  if(patch.quotedRate!==undefined&&String(Number(patch.quotedRate))!==String(Number(current.quotedRate))||patch.unitId!==undefined&&patch.unitId!==current.unitId||patch.customerId!==undefined&&patch.customerId!==current.customerId||patch.facilityId!==undefined&&patch.facilityId!==current.facilityId||patch.intendedMoveIn!==undefined&&patch.intendedMoveIn.getTime()!==current.intendedMoveIn?.getTime())throw Error("PRICE_GOVERNED_WORKFLOW_REQUIRED");
}
