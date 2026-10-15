import {createHash} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {facilityWhere,type RequestScope} from "./scope";
import {effectiveEntries} from "./collections-policy";
import {buildAccountStatement} from "./finance/account-statement";
import {isTestPayment} from "./payments/payment-evidence";
import {receiptCents,receiptReallocationInput,type ReallocationAccount,type ReceiptPosition,type ReceiptRoot,type ReallocationUndo} from "./receipt-reallocation-policy";

type Tx=Prisma.TransactionClient;
const LIMIT=5000;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const allocationHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)).digest("hex");
export const receiptAmount=(value:number)=>(value/100).toFixed(2);
const bounded=<T>(values:T[])=>{if(values.length>LIMIT)throw Error("REALLOCATION_LIMIT");return values;};
function fail():never{throw Error("REALLOCATION_RECEIPT_REVIEW");}

/** Complete bounded, same-store receipt graph. No writes or provider calls.
 * A caller that will post must acquire every returned account lock, then reload
 * this evidence within its serializable transaction before checking a request. */
export async function receiptAllocationGraph(tx:Tx,scope:RequestScope,paymentId:string,extraAccountIds:string[]=[],ownRequestId?:string,ownAdjustmentId?:string){
  const payment=await tx.payment.findFirst({where:{id:paymentId,account:{customer:{organisationId:scope.organisationId},tenancy:{facility:facilityWhere(scope)}}},include:{account:{include:{tenancy:true}},merchandiseOrder:{select:{id:true}}}});
  if(!payment?.account.tenancy)throw Error("REALLOCATION_NOT_FOUND");
  const facilityId=payment.account.tenancy.facilityId;
  if(payment.currency!=="ZAR"||payment.merchandiseOrder||isTestPayment(payment)||(payment.provider!==null||payment.environment!==null)&&payment.environment!=="live")fail();
  const moves=bounded(await tx.receiptReallocation.findMany({where:{paymentId,status:"POSTED"},take:LIMIT+1,orderBy:{id:"asc"}}));
  if(moves.some(m=>m.organisationId!==scope.organisationId||m.facilityId!==facilityId))fail();
  const ids=[...new Set([payment.accountId,...moves.flatMap(m=>[m.sourceAccountId,m.targetAccountId]),...extraAccountIds])].sort();
  if(ids.length>2000)throw Error("REALLOCATION_LIMIT");
  const accountRows=await tx.account.findMany({where:{id:{in:ids},customer:{organisationId:scope.organisationId},tenancy:{facility:facilityWhere(scope)}},orderBy:{id:"asc"},include:{customer:{select:{organisationId:true}},tenancy:true}});
  if(accountRows.length!==ids.length)throw Error("REALLOCATION_NOT_FOUND");
  if(accountRows.some(a=>!a.tenancy||a.tenancy.facilityId!==facilityId||a.currency!=="ZAR"))throw Error("REALLOCATION_SCOPE");
  const entries=bounded(await tx.ledgerEntry.findMany({where:{accountId:{in:ids}},take:LIMIT+1,orderBy:[{effectiveAt:"asc"},{id:"asc"}]}));
  const adjustments=bounded(await tx.financialAdjustment.findMany({where:{accountId:{in:ids},status:"POSTED"},take:LIMIT+1,orderBy:{id:"asc"}}));
  const pending=bounded(await tx.receiptReallocation.findMany({where:{OR:[{sourceAccountId:{in:ids}},{targetAccountId:{in:ids}}],status:"PENDING_APPROVAL",...(ownRequestId?{id:{not:ownRequestId}}:{})},take:LIMIT+1,orderBy:{id:"asc"},select:{id:true,sourceAccountId:true,targetAccountId:true}}));
  const openAdjustments=bounded(await tx.financialAdjustment.findMany({where:{accountId:{in:ids},status:{in:["PENDING_APPROVAL","APPROVED"]},...(ownAdjustmentId?{id:{not:ownAdjustmentId}}:{})},take:LIMIT+1,orderBy:{id:"asc"},select:{accountId:true}}));
  const instructions=bounded(await tx.debitOrderInstruction.findMany({where:{accountId:{in:ids},run:{status:{not:"CANCELLED"}}},take:LIMIT+1,orderBy:{id:"asc"},select:{accountId:true}}));
  const pendingPayments=bounded(await tx.payment.findMany({where:{accountId:{in:ids},status:"PENDING"},take:LIMIT+1,orderBy:{id:"asc"},select:{accountId:true,status:true,idempotencyKey:true,environment:true}}));
  const entryMap=new Map(entries.map(e=>[e.id,e]));
  const originals=entries.filter(e=>e.type==="PAYMENT"&&(e.externalRef===payment.idempotencyKey||object(e.metadata).paymentId===payment.id));
  if(originals.length!==1||originals[0].accountId!==payment.accountId||!originals[0].amount.equals(payment.amount)||!originals[0].taxAmount.isZero())fail();
  const original=originals[0],metadata=object(original.metadata);
  const rootAudits=bounded(await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"Payment",entityId:payment.id,action:{in:["payment.posted","booking.payment_recorded"]}},take:LIMIT+1,orderBy:{id:"asc"},select:{facilityId:true}}));
  if(!rootAudits.some(a=>a.facilityId===null||a.facilityId===facilityId)&&!(payment.provider==="NETCASH"&&metadata.verifiedStatus===true&&metadata.environment==="live"))fail();
  const audits=moves.length?bounded(await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"ReceiptReallocation",entityId:{in:moves.map(m=>m.id)},action:{in:["receipt_reallocation.requested","receipt_reallocation.posted"]}},take:LIMIT+1,orderBy:{id:"asc"},select:{entityId:true,actorId:true,facilityId:true,action:true,after:true}})):[];
  const documents=moves.length?bounded(await tx.document.findMany({where:{id:{in:moves.flatMap(m=>[m.sourceDocumentId,m.targetDocumentId].filter((id):id is string=>!!id))}},take:LIMIT+1,orderBy:{id:"asc"},select:{id:true,tenancyId:true,sha256:true,content:true}})):[];
  if(documents.reduce((n,d)=>n+Buffer.byteLength(d.content??""),0)>10*1024*1024)throw Error("REALLOCATION_LIMIT");
  const knownCredits=new Set([original.id]),knownLegs=new Set<string>(),verified=new Map<string,typeof moves[number]>(),remaining=new Set(moves.map(m=>m.id));
  const undone=new Map<string,number>();
  while(remaining.size){
    let progressed=false;
    for(const row of moves){
      if(!remaining.has(row.id)||!knownCredits.has(row.sourceEntryId)||row.operation==="UNDO"&&!verified.has(row.reversesId??""))continue;
      const source=entryMap.get(row.sourceEntryId),out=entryMap.get(row.sourceLedgerEntryId??""),into=entryMap.get(row.targetLedgerEntryId??"");
      if(!source||!out||!into||source.type!=="PAYMENT"||source.accountId!==row.sourceAccountId||!row.reviewedById||row.reviewedById===row.requestedById||row.postedById!==row.reviewedById||!row.postedAt||!row.reviewedAt||!row.reviewReference||allocationHash(row.snapshot)!==row.fingerprint)fail();
      const request=receiptReallocationInput.parse(object(row.snapshot).input);
      if(allocationHash(request)!==row.requestHash||request.operation!==row.operation||request.reversesId!==row.reversesId||request.sourceAccountId!==row.sourceAccountId||request.targetAccountId!==row.targetAccountId||request.sourceEntryId!==row.sourceEntryId||request.requestKey!==row.requestKey||request.reason!==row.reason||request.evidenceReference!==row.evidenceReference||receiptCents(request.amount)!==receiptCents(row.amount.toString()))fail();
      if(out!.accountId!==row.sourceAccountId||into!.accountId!==row.targetAccountId||out!.type!=="REVERSAL"||out!.reversalOfId!==row.sourceEntryId||!out!.amount.equals(row.amount)||!into!.amount.equals(row.amount)||!out!.taxAmount.isZero()||!into!.taxAmount.isZero()||out!.effectiveAt.getTime()!==into!.effectiveAt.getTime()||source!.effectiveAt>out!.effectiveAt||row.postedAt!.getTime()!==out!.effectiveAt.getTime())fail();
      for(const [leg,suffix] of [[out!,"out"],[into!,"in"]] as const)if(leg.externalRef!==`receipt-reallocation:${row.id}:${suffix}`||leg.createdById!==row.reviewedById||object(leg.metadata).receiptReallocationId!==row.id||object(leg.metadata).rootPaymentId!==payment.id)fail();
      if(row.operation==="MOVE"){
        if(row.reversesId||into!.type!=="PAYMENT"||into!.reversalOfId)fail();knownCredits.add(into!.id);
      }else if(row.operation==="UNDO"){
        const parent=verified.get(row.reversesId??"");
        if(!parent||parent.operation!=="MOVE"||parent.sourceAccountId!==row.targetAccountId||parent.targetAccountId!==row.sourceAccountId||parent.targetLedgerEntryId!==row.sourceEntryId||into!.type!=="REVERSAL"||into!.reversalOfId!==parent.sourceLedgerEntryId)fail();
        const total=(undone.get(parent!.id)??0)+receiptCents(row.amount.toString());if(total>receiptCents(parent!.amount.toString()))fail();undone.set(parent!.id,total);
      }else fail();
      const requested=audits.filter(a=>a.entityId===row.id&&a.action==="receipt_reallocation.requested"),posted=audits.filter(a=>a.entityId===row.id&&a.action==="receipt_reallocation.posted");
      if(requested.length!==1||posted.length!==1||requested[0].actorId!==row.requestedById||posted[0].actorId!==row.reviewedById||[...requested,...posted].some(a=>a.facilityId!==facilityId||object(a.after).fingerprint!==row.fingerprint)||object(posted[0].after).sourceLedgerEntryId!==out!.id||object(posted[0].after).targetLedgerEntryId!==into!.id)fail();
      for(const [id,accountId] of [[row.sourceDocumentId,row.sourceAccountId],[row.targetDocumentId,row.targetAccountId]]){
        const doc=documents.find(d=>d.id===id),account=accountRows.find(a=>a.id===accountId);
        if(!doc?.content||!doc.sha256||doc.tenancyId!==account?.tenancy?.id||createHash("sha256").update(doc.content).digest("hex")!==doc.sha256)fail();
      }
      knownLegs.add(out!.id);knownLegs.add(into!.id);verified.set(row.id,row);remaining.delete(row.id);progressed=true;
    }
    if(!progressed)fail();
  }
  const correctionIds=adjustments.filter(a=>a.paymentId===payment.id).map(a=>a.id);
  const correctionAudits=correctionIds.length?bounded(await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"FinancialAdjustment",entityId:{in:correctionIds},action:"adjustment.posted"},take:LIMIT+1,orderBy:{id:"asc"},select:{entityId:true,actorId:true,facilityId:true,after:true}})):[];
  const positions:ReceiptPosition[]=[],accounts:ReallocationAccount[]=[];
  let refunded=0,reversed=0;
  for(const a of adjustments.filter(a=>a.paymentId===payment.id)){
    const leg=entryMap.get(a.ledgerEntryId??"");
    if(a.organisationId!==scope.organisationId||a.facilityId!==facilityId||!a.sourceEntryId||!knownCredits.has(a.sourceEntryId)||!leg||!leg.amount.equals(a.amount)||!leg.taxAmount.isZero()||!a.reviewedById||a.reviewedById===a.requestedById||a.postedById!==a.reviewedById||!a.postedAt||leg.externalRef!==`adjustment:${a.id}`||object(leg.metadata).adjustmentId!==a.id||object(leg.metadata).sourceEntryId!==a.sourceEntryId||leg.accountId!==a.accountId||leg.createdById!==a.postedById||entryMap.get(a.sourceEntryId)?.accountId!==a.accountId)fail();
    const proof=correctionAudits.filter(e=>e.entityId===a.id);if(proof.length!==1||proof[0].actorId!==a.postedById||proof[0].facilityId!==facilityId||object(proof[0].after).ledgerEntryId!==leg!.id||object(proof[0].after).documentId!==a.documentId)fail();
    if(a.kind==="REFUND"&&leg!.type==="REFUND"&&a.payoutReference&&a.payoutDate)refunded+=receiptCents(a.amount.toString());
    else if(a.kind==="REVERSAL"&&leg!.type==="REVERSAL"&&a.sourceEntryId===original.id&&leg!.reversalOfId===original.id)reversed+=receiptCents(a.amount.toString());else fail();knownLegs.add(leg!.id);
  }
  for(const row of accountRows){
    const ledger=entries.filter(e=>e.accountId===row.id);
    if(ledger.some(e=>e.effectiveAt>new Date()))fail();
    const normalized=ledger.map(e=>({...e,amount:e.amount.toString()})),values=effectiveEntries(normalized,"9998-12-31");
    const ledgerBalance=buildAccountStatement(normalized,new Date(0),new Date("9999-01-01")).closingBalance;
    if(receiptCents(ledgerBalance,true)!==receiptCents(row.balance.toString(),true))throw Error("REALLOCATION_RECONCILIATION");
    for(const e of ledger){
      if(object(e.metadata).receiptReallocationId&&!knownLegs.has(e.id)&&object(e.metadata).rootPaymentId===payment.id)fail();
      let root=e;const seen=new Set<string>();while(root.type==="REVERSAL"){if(seen.has(root.id))fail();seen.add(root.id);const parent=entryMap.get(root.reversalOfId??"");if(!parent)fail();root=parent!;}
      if(root.type==="PAYMENT"&&knownCredits.has(root.id)&&e.type==="REVERSAL"&&!knownLegs.has(e.id))fail();
    }
    for(const v of values.filter(v=>knownCredits.has(v.entry.id))){
      // Refunds bind to the credit being reduced, never another receipt.
      const refund=values.filter(r=>r.entry.type==="REFUND"&&object(r.entry.metadata).sourceEntryId===v.entry.id);
      if(refund.some(r=>!knownLegs.has(r.entry.id)))fail();const available=v.amount-refund.reduce((n,r)=>n+r.amount,0);if(available<0)fail();
      positions.push({entryId:v.entry.id,accountId:row.id,organisationId:scope.organisationId,facilityId,remaining:receiptAmount(available)});
    }
    const inFlight=openAdjustments.some(a=>a.accountId===row.id)||instructions.some(i=>i.accountId===row.id)||pending.some(p=>p.sourceAccountId===row.id||p.targetAccountId===row.id)||pendingPayments.some(p=>p.accountId===row.id&&!isTestPayment(p));
    accounts.push({id:row.id,organisationId:scope.organisationId,facilityId,currency:row.currency,balance:row.balance.toString(),ledgerBalance,hasTenancy:!!row.tenancy,inFlight});
  }
  const received=receiptCents(payment.amount.toString()),total=positions.reduce((n,p)=>n+receiptCents(p.remaining),0);
  const expected=received-refunded-reversed;
  if(!Number.isSafeInteger(total)||expected<0||total!==expected||reversed&&reversed!==received||payment.status!==(reversed?"REVERSED":refunded===received?"REFUNDED":refunded>0?"PARTIALLY_REFUNDED":"SUCCEEDED"))fail();
  const root:ReceiptRoot={paymentId:payment.id,organisationId:scope.organisationId,facilityId,currency:payment.currency,provider:payment.provider,environment:payment.environment,status:payment.status,amount:payment.amount.toString(),refunded:receiptAmount(refunded),postedExactlyOnce:true,verified:true};
  const undoParents:ReallocationUndo[]=moves.filter(m=>m.operation==="MOVE").map(m=>({id:m.id,operation:m.operation,paymentId:payment.id,sourceAccountId:m.sourceAccountId,targetAccountId:m.targetAccountId,sourceLedgerEntryId:m.sourceLedgerEntryId!,targetLedgerEntryId:m.targetLedgerEntryId!,remaining:receiptAmount(receiptCents(m.amount.toString())-(undone.get(m.id)??0)),verified:true}));
  const digest=allocationHash({root,payment:{id:payment.id,status:payment.status,amount:payment.amount,currency:payment.currency,environment:payment.environment,updatedAt:payment.updatedAt},accounts,entries,moves,adjustments,rootAudits,audits,documents:documents.map(d=>({id:d.id,sha256:d.sha256})),pending,openAdjustments,instructions,pendingPayments,correctionAudits});
  return {root,accounts,positions,undoParents,accountIds:ids,digest,originalEntryId:original.id,receivedAt:original.effectiveAt,recordedAt:original.createdAt,verifiedLedgerIds:[...knownLegs]};
}
