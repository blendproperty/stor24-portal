import {z} from "zod";

const amount=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
export const receiptReallocationInput=z.object({operation:z.enum(["MOVE","UNDO"]).default("MOVE"),reversesId:z.cuid().nullable().default(null),sourceAccountId:z.cuid(),sourceEntryId:z.cuid(),targetAccountId:z.cuid(),amount,reason:z.string().trim().min(10).max(500),evidenceReference:z.string().trim().min(5).max(200),requestKey:z.uuid()}).strict().refine(v=>(v.operation==="UNDO")===Boolean(v.reversesId),"An undo must identify the original allocation.");
export type ReceiptReallocationInput=z.input<typeof receiptReallocationInput>;
export function receiptCents(text:string,signed=false){
  if(!(signed?/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/:/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).test(text))throw Error("REALLOCATION_AMOUNT");
  const negative=text.startsWith("-"),[whole,fraction=""]=text.replace(/^-/ ,"").split(".");
  const value=(BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0")))*(negative?-BigInt(1):BigInt(1));
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw Error("REALLOCATION_AMOUNT");return Number(value);
}
export type ReallocationAccount={id:string;organisationId:string;facilityId:string;currency:string;balance:string;ledgerBalance:string;hasTenancy:boolean;inFlight:boolean};
export type ReceiptPosition={entryId:string;accountId:string;organisationId:string;facilityId:string;remaining:string};
export type ReallocationUndo={id:string;operation:string;paymentId:string;sourceAccountId:string;targetAccountId:string;sourceLedgerEntryId:string;targetLedgerEntryId:string;remaining:string;verified:boolean};
export type ReceiptRoot={paymentId:string;organisationId:string;facilityId:string;currency:string;provider:string|null;environment:string|null;status:string;amount:string;refunded:string;postedExactlyOnce:boolean;verified:boolean};

/** A reallocation changes only the account allocation of an already verified
 * receipt. The single external Payment is retained; no new cash is received. */
export function planReceiptReallocation(input:ReceiptReallocationInput,source:ReallocationAccount,target:ReallocationAccount,root:ReceiptRoot,positions:ReceiptPosition[],undo?:ReallocationUndo){
  const request=receiptReallocationInput.parse(input),value=receiptCents(request.amount);
  if(value<=0)throw Error("REALLOCATION_AMOUNT");
  if(source.id!==request.sourceAccountId||target.id!==request.targetAccountId||source.id===target.id||source.organisationId!==target.organisationId||source.facilityId!==target.facilityId||root.organisationId!==source.organisationId||root.facilityId!==source.facilityId)throw Error("REALLOCATION_SCOPE");
  for(const account of [source,target]){
    if(account.currency!=="ZAR"||!account.hasTenancy)throw Error("REALLOCATION_ACCOUNT_REVIEW");
    if(receiptCents(account.balance,true)!==receiptCents(account.ledgerBalance,true))throw Error("REALLOCATION_RECONCILIATION");
    if(account.inFlight)throw Error("REALLOCATION_PENDING_ACTIVITY");
  }
  const received=receiptCents(root.amount),refunded=receiptCents(root.refunded);
  if(root.currency!=="ZAR"||!root.verified||!root.postedExactlyOnce||(root.provider!==null||root.environment!==null)&&root.environment!=="live"||received<=0||refunded>=received||root.status!==(refunded>0?"PARTIALLY_REFUNDED":"SUCCEEDED"))throw Error("REALLOCATION_RECEIPT_REVIEW");
  if(!positions.length||positions.length>5000||new Set(positions.map(p=>p.entryId)).size!==positions.length)throw Error("REALLOCATION_RECONCILIATION");
  let total=0;
  for(const position of positions){
    if(position.organisationId!==root.organisationId||position.facilityId!==root.facilityId)throw Error("REALLOCATION_SCOPE");
    total+=receiptCents(position.remaining);if(!Number.isSafeInteger(total))throw Error("REALLOCATION_AMOUNT");
  }
  if(total!==received-refunded)throw Error("REALLOCATION_RECONCILIATION");
  const position=positions.find(p=>p.entryId===request.sourceEntryId&&p.accountId===source.id);
  if(!position||value>receiptCents(position.remaining))throw Error("REALLOCATION_EXCEEDS_RECEIPT");
  if(request.operation==="UNDO"&&(!undo||!undo.verified||undo.operation!=="MOVE"||undo.id!==request.reversesId||undo.paymentId!==root.paymentId||undo.sourceAccountId!==target.id||undo.targetAccountId!==source.id||undo.targetLedgerEntryId!==position.entryId||value>receiptCents(undo.remaining)))throw Error("REALLOCATION_UNDO_REVIEW");
  const incoming=request.operation==="UNDO"?{type:"REVERSAL" as const,reversalOfId:undo!.sourceLedgerEntryId}:{type:"PAYMENT" as const,rootPaymentId:root.paymentId};
  const sourceAfter=receiptCents(source.balance,true)+value,targetAfter=receiptCents(target.balance,true)-value;
  if(!Number.isSafeInteger(sourceAfter)||!Number.isSafeInteger(targetAfter)||Math.abs(sourceAfter)>99999999999999||Math.abs(targetAfter)>99999999999999||sourceAfter+targetAfter!==receiptCents(source.balance,true)+receiptCents(target.balance,true))throw Error("REALLOCATION_AMOUNT");
  return {operation:request.operation,reversesId:request.reversesId,rootPaymentId:root.paymentId,amountCents:value,taxCents:0,sourceBalanceAfterCents:sourceAfter,targetBalanceAfterCents:targetAfter,sourceReceiptRemainingCents:receiptCents(position.remaining)-value,totalReceiptRemainingCents:total,outgoing:{type:"REVERSAL" as const,reversalOfId:position.entryId},incoming,externalPaymentCreated:false as const,providerRequest:false as const};
}
export function requireReallocationReviewer(requestedBy:string,reviewedBy:string){if(requestedBy===reviewedBy)throw Error("REALLOCATION_INDEPENDENT_REVIEW");}

export const receiptReallocationNotice="Moves an existing verified receipt between two tenancy accounts in the same store after independent approval. It does not receive another payment, refund a customer or change the original provider receipt. Original receipt and correction history remain available.";
