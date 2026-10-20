import {createHash} from "node:crypto";
import {z} from "zod";
import {decryptIntegrationSecret} from "./integrations/integration-secret-vault";
import {reservationPriceAdjustmentSchema,reservationPriceReasonSchema,negotiatedMonthlyRate} from "./reservation-price-policy";
import {publicInitialRent} from "./public-initial-rent";

const canonical=(value:unknown):string=>JSON.stringify(value,(_,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const hash=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const originalSchema=z.object({version:z.literal(1),reservationId:z.string(),organisationId:z.string(),facilityId:z.string(),customerId:z.string(),quotedRate:z.string(),initialRentSnapshot:z.unknown(),intendedMoveIn:z.iso.datetime()}).passthrough();
const proposedSchema=z.object({version:z.literal(1),monthlyRate:z.string(),initialRentSnapshot:z.unknown(),reason:z.string().min(10),adjustment:reservationPriceAdjustmentSchema.optional(),reasonSelection:z.union([reservationPriceReasonSchema,reservationPriceReasonSchema.options[0].extend({campaignName:z.string().min(1).max(300)})]).optional()}).strict();
export type PriceHistoryBooking={id:string;facilityId:string;customerId:string;quotedRate:unknown;initialRentSnapshot:unknown;intendedMoveIn:Date|null};
export type PriceHistoryItem={id:string;organisationId:string;facilityId:string;reservationId:string;sourceFingerprint:string;quoteFingerprint:string;originalEncrypted:string;proposedEncrypted:string;proposedById:string;reviewedById:string|null;reviewedAt:Date|null;reviewReference:string|null;acceptedCustomerId:string|null;acceptedAt:Date|null;acceptanceFingerprint:string|null;expiresAt:Date;createdAt:Date};
export type PriceHistoryAudit={entityId:string;facilityId:string|null;actorId:string|null;action:string;after:unknown};
export type BookingPriceEvidence={original:{quotedRate:string;initialRentSnapshot:unknown;intendedMoveIn:Date}|null;acceptedChanges:number;latestAcceptedQuote:string|null;latestAcceptedAt:string|null;issue:string|null};

/** Accepted quotes are customer consent evidence, not signed/effective rent or
 * revenue. Missing or inconsistent archives/audits hold the complete row. */
export function bookingPriceEvidence(organisationId:string,booking:PriceHistoryBooking,items:PriceHistoryItem[],audits:PriceHistoryAudit[],asOf:Date):BookingPriceEvidence{
  const empty:BookingPriceEvidence={original:null,acceptedChanges:0,latestAcceptedQuote:null,latestAcceptedAt:null,issue:null};
  if(!items.length)return empty;
  try{
    if(!Number.isFinite(asOf.getTime())||new Set(items.map(i=>i.id)).size!==items.length)throw Error();
    const ordered=[...items].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||(a.id<b.id?-1:a.id>b.id?1:0));
    let previous:z.infer<typeof proposedSchema>|null=null,previousAccepted:Date|null=null;
    for(const item of ordered){
      if(item.organisationId!==organisationId||item.facilityId!==booking.facilityId||item.reservationId!==booking.id||item.acceptedCustomerId!==booking.customerId||!item.reviewedById||!item.reviewedAt||!item.acceptedAt||!item.reviewReference||item.acceptanceFingerprint!==item.quoteFingerprint||item.acceptedAt<=item.reviewedAt||item.acceptedAt>item.expiresAt||previousAccepted&&item.reviewedAt<=previousAccepted)throw Error();
      const raw=JSON.parse(decryptIntegrationSecret(item.originalEncrypted));
      if(hash(raw)!==item.sourceFingerprint)throw Error();
      const original=originalSchema.parse(raw),proposed=proposedSchema.parse(JSON.parse(decryptIntegrationSecret(item.proposedEncrypted)));
      if(original.intendedMoveIn!==booking.intendedMoveIn?.toISOString()||original.organisationId!==organisationId||original.reservationId!==booking.id||original.facilityId!==booking.facilityId||original.customerId!==booking.customerId)throw Error();
      if(hash({reservationId:booking.id,sourceFingerprint:item.sourceFingerprint,proposed,expiresAt:item.expiresAt.toISOString()})!==item.quoteFingerprint)throw Error();
      if(Number(proposed.monthlyRate)>10000000||proposed.adjustment&&negotiatedMonthlyRate(original.quotedRate,proposed.adjustment)!==proposed.monthlyRate)throw Error();
      const date=new Date(original.intendedMoveIn);
      for(const quote of [{quotedRate:original.quotedRate,initialRentSnapshot:original.initialRentSnapshot},{quotedRate:proposed.monthlyRate,initialRentSnapshot:proposed.initialRentSnapshot}]){
        const rate=Number(quote.quotedRate);if(!Number.isFinite(rate)||rate<=0||!Number.isSafeInteger(Math.round(rate*100))||Math.abs(rate*100-Math.round(rate*100))>0.000001||quote.initialRentSnapshot==null)throw Error();
        publicInitialRent({...quote,intendedMoveIn:date});
      }
      if(previous&&(previous.monthlyRate!==original.quotedRate||canonical(previous.initialRentSnapshot)!==canonical(original.initialRentSnapshot)))throw Error();
      const approvals=audits.filter(a=>a.entityId===item.id&&a.action==="reservation.price_approved"),acceptances=audits.filter(a=>a.entityId===item.id&&a.action==="reservation.price_customer_accepted");
      if(approvals.length!==1||acceptances.length!==1)throw Error();
      const approval=approvals[0],acceptance=acceptances[0];
      const approved=z.object({reservationId:z.string(),quoteFingerprint:z.string(),reference:z.string(),financialPosting:z.literal(false)}).passthrough().parse(approval.after);
      const accepted=z.object({reservationId:z.string(),customerId:z.string(),quoteFingerprint:z.string(),verifiedAt:z.iso.datetime(),acceptedAt:z.iso.datetime(),newAgreementRequired:z.literal(true),financialPosting:z.literal(false)}).strict().parse(acceptance.after);
      if(approval.facilityId!==booking.facilityId||acceptance.facilityId!==booking.facilityId||approval.actorId!==item.reviewedById||acceptance.actorId!==null||approved.reservationId!==booking.id||approved.quoteFingerprint!==item.quoteFingerprint||approved.reference!==item.reviewReference||accepted.reservationId!==booking.id||accepted.customerId!==booking.customerId||accepted.quoteFingerprint!==item.quoteFingerprint||accepted.acceptedAt!==item.acceptedAt.toISOString()||new Date(accepted.verifiedAt)<=item.reviewedAt||new Date(accepted.verifiedAt)>item.acceptedAt)throw Error();
      empty.original??={quotedRate:original.quotedRate,initialRentSnapshot:original.initialRentSnapshot,intendedMoveIn:date};
      if(item.acceptedAt<asOf){empty.acceptedChanges++;empty.latestAcceptedQuote=proposed.monthlyRate;empty.latestAcceptedAt=item.acceptedAt.toISOString();}
      previous=proposed;previousAccepted=item.acceptedAt;
    }
    if(!previous||Number(booking.quotedRate)!==Number(previous.monthlyRate)||canonical(booking.initialRentSnapshot)!==canonical(previous.initialRentSnapshot))throw Error();
    return empty;
  }catch{return {...empty,original:null,acceptedChanges:0,latestAcceptedQuote:null,latestAcceptedAt:null,issue:"Accepted booking price history requires review"};}
}
