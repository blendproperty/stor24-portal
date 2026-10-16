import {requireCurrentFinanceAuthority} from './finance/current-finance-authority';
import {createHash} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {db} from "./db";
import {retryRolledBackFinanceTransaction} from './finance/retry-rolled-back-transaction';
import {facilityWhere,type RequestScope} from "./scope";
import {documentShellHtml,escapeHtml,formatZar} from "./finance/billing-document-brand";
import {allocationHash,receiptAllocationGraph,receiptAmount} from "./receipt-reallocation-source";
import {planReceiptReallocation,receiptReallocationInput,requireReallocationReviewer,type ReceiptReallocationInput} from "./receipt-reallocation-policy";

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const scoped=(scope:RequestScope)=>({organisationId:scope.organisationId,...(scope.unrestrictedFacilities?{}:{facilityId:{in:scope.facilityIds}})});
async function accountScope(tx:Tx,scope:RequestScope,ids:string[]){
  if(await tx.account.count({where:{id:{in:ids},customer:{organisationId:scope.organisationId},tenancy:{facility:facilityWhere(scope)}}})!==new Set(ids).size)throw Error("REALLOCATION_NOT_FOUND");
}
async function rootFor(tx:Tx,scope:RequestScope,accountId:string,entryId:string){
  await accountScope(tx,scope,[accountId]);
  const entry=await tx.ledgerEntry.findFirst({where:{id:entryId,accountId,type:"PAYMENT"},include:{receiptReallocationIncoming:true}});
  if(!entry)throw Error("REALLOCATION_RECEIPT_REVIEW");
  if(entry.receiptReallocationIncoming){if(entry.receiptReallocationIncoming.status!=="POSTED"||entry.receiptReallocationIncoming.operation!=="MOVE")throw Error("REALLOCATION_RECEIPT_REVIEW");return entry.receiptReallocationIncoming.paymentId;}
  const payments=await tx.payment.findMany({where:{accountId},take:5001,select:{id:true,idempotencyKey:true}});if(payments.length>5000)throw Error("REALLOCATION_LIMIT");
  const matched=payments.filter(p=>object(entry.metadata).paymentId===p.id||entry.externalRef===p.idempotencyKey);
  if(matched.length!==1)throw Error("REALLOCATION_RECEIPT_REVIEW");return matched[0].id;
}
async function context(tx:Tx,scope:RequestScope,input:ReceiptReallocationInput,ownId?:string){
  const data=receiptReallocationInput.parse(input),paymentId=await rootFor(tx,scope,data.sourceAccountId,data.sourceEntryId);
  const graph=await receiptAllocationGraph(tx,scope,paymentId,[data.sourceAccountId,data.targetAccountId],ownId);
  const source=graph.accounts.find(a=>a.id===data.sourceAccountId),target=graph.accounts.find(a=>a.id===data.targetAccountId);
  if(!source||!target)throw Error("REALLOCATION_NOT_FOUND");
  const plan=planReceiptReallocation(data,source,target,graph.root,graph.positions,graph.undoParents.find(p=>p.id===data.reversesId));
  const snapshot={input:data,root:graph.root,source,target,plan,graphDigest:graph.digest};
  return {data,graph,plan,snapshot,fingerprint:allocationHash(snapshot)};
}
async function audit(tx:Tx,scope:RequestScope,row:{id:string;facilityId:string},action:string,after:unknown){
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:row.facilityId,actorId:scope.userId,entityType:"ReceiptReallocation",entityId:row.id,action:`receipt_reallocation.${action}`,after:json(after)}});
}
async function lock(tx:Tx,ids:string[]){for(const id of [...new Set(ids)].sort())await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${id} FOR UPDATE`;}
function sameLocks(actual:string[],locked:string[]){if(allocationHash(actual)!==allocationHash(locked))throw Error("REALLOCATION_CHANGED");}
export async function previewReceiptReallocation(scope:RequestScope,input:ReceiptReallocationInput){return db.$transaction(async tx=>{
  const c=await context(tx,scope,input);return {fingerprint:c.fingerprint,snapshot:c.snapshot};
},{isolationLevel:"RepeatableRead",timeout:30000});}

async function requestReceiptReallocationOnce(scope:RequestScope,input:ReceiptReallocationInput,fingerprint:string){
  const data=receiptReallocationInput.parse(input),requestHash=allocationHash(data);
  const retry=async()=>{
    const row=await db.receiptReallocation.findUnique({where:{organisationId_requestKey:{organisationId:scope.organisationId,requestKey:data.requestKey}}});
    if(!row)return null;await accountScope(db,scope,[row.sourceAccountId,row.targetAccountId]);
    await requireCurrentFinanceAuthority(db,scope,["adjustments.view","billing.view","adjustments.request"],row.facilityId);
    if(row.requestHash!==requestHash||row.requestedById!==scope.userId)throw Error("REALLOCATION_DUPLICATE");return {id:row.id,idempotent:true};
  };
  const existing=await retry();if(existing)return existing;
  try{const discovery=await context(db,scope,data);return await db.$transaction(async tx=>{
    await lock(tx,discovery.graph.accountIds);
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id"=${discovery.graph.root.paymentId} FOR UPDATE`;
    const c=await context(tx,scope,data);sameLocks(c.graph.accountIds,discovery.graph.accountIds);
    await requireCurrentFinanceAuthority(tx,scope,["adjustments.view","billing.view","adjustments.request"],c.graph.root.facilityId);
    if(c.fingerprint!==fingerprint)throw Error("REALLOCATION_CHANGED");
    const row=await tx.receiptReallocation.create({data:{organisationId:scope.organisationId,facilityId:c.graph.root.facilityId,sourceAccountId:data.sourceAccountId,targetAccountId:data.targetAccountId,sourceEntryId:data.sourceEntryId,paymentId:c.graph.root.paymentId,operation:c.data.operation,reversesId:c.data.reversesId,requestKey:data.requestKey,requestHash,amount:receiptAmount(c.plan.amountCents),reason:c.data.reason,evidenceReference:c.data.evidenceReference,snapshot:json(c.snapshot),fingerprint,requestedById:scope.userId}});
    await audit(tx,scope,row,"requested",{fingerprint,amountCents:c.plan.amountCents,operation:c.data.operation});return {id:row.id,idempotent:false};
  },{isolationLevel:"Serializable",timeout:30000});}catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
    if(["P2002","P2034"].includes(code)||error instanceof Error&&error.message==="REALLOCATION_PENDING_ACTIVITY"){const found=await retry();if(found)return found;}throw error;
  }
}

async function correctionDocument(tx:Tx,id:string,side:"source"|"target",accountId:string,amount:number,before:string,after:number,reason:string,evidence:string,reference:string,rootPaymentId:string,operation:string){
  const account=await tx.account.findUniqueOrThrow({where:{id:accountId},include:{tenancy:true}});if(!account.tenancy)throw Error("REALLOCATION_ACCOUNT_REVIEW");
  const title=operation==="UNDO"?"Receipt allocation undo":"Receipt allocation correction";
  const body=documentShellHtml({title,preheader:title,bodyHtml:`<h1>${escapeHtml(title)}</h1><p>Reference: ${escapeHtml(id)}</p><p>Account: ${escapeHtml(account.accountNumber)}</p><p>${side==="source"?"Allocation removed":"Allocation restored or added"}: ${formatZar(receiptAmount(amount))}</p><p>Balance before: ${formatZar(before)} · Balance after: ${formatZar(receiptAmount(after))}</p><p>${escapeHtml(reason)}</p><p>Evidence: ${escapeHtml(evidence)} · Independent approval: ${escapeHtml(reference)}</p><p>Original receipt reference: ${escapeHtml(rootPaymentId)}</p><p>The original provider receipt remains unchanged. This is an internal allocation correction, not a new payment, refund, tax adjustment or bank settlement confirmation.</p>`});
  const sha256=createHash("sha256").update(body).digest("hex");
  return tx.document.create({data:{tenancyId:account.tenancy.id,type:"ADJUSTMENT",status:"GENERATED",content:body,sha256,storageKey:`inline:${sha256}`,externalId:`RC-${id}-${side}`,idempotencyKey:`receipt-reallocation:${id}:${side}-document`}});
}

async function decideReceiptReallocationOnce(scope:RequestScope,id:string,revision:number,action:"approve"|"reject"|"cancel",reference:string){
  if(!Number.isInteger(revision)||revision<0||reference.trim().length<5||reference.trim().length>200)throw Error("REALLOCATION_DECISION");reference=reference.trim();
  const initial=await db.receiptReallocation.findFirst({where:{id,...scoped(scope)}});if(!initial)throw Error("REALLOCATION_NOT_FOUND");
  await accountScope(db,scope,[initial.sourceAccountId,initial.targetAccountId]);
  if(action==="cancel"){if(initial.requestedById!==scope.userId)throw Error("FORBIDDEN");}else requireReallocationReviewer(initial.requestedById,scope.userId);
  const final=action==="approve"?"POSTED":action==="reject"?"REJECTED":"CANCELLED";
  await requireCurrentFinanceAuthority(db,scope,["adjustments.view","billing.view",action==="cancel"?"adjustments.request":"adjustments.approve"],initial.facilityId);
  if(initial.status!=="PENDING_APPROVAL"){
    if(initial.status===final&&initial.reviewedById===scope.userId&&initial.reviewReference===reference)return {id,status:initial.status,idempotent:true};throw Error("REALLOCATION_STATE");
  }
  const input=receiptReallocationInput.parse(object(initial.snapshot).input);
  const discovery=action==="approve"?await context(db,scope,input,id):null;
  return db.$transaction(async tx=>{
    const locked=discovery?.graph.accountIds??[initial.sourceAccountId,initial.targetAccountId].sort();await lock(tx,locked);
    if(discovery)await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id"=${discovery.graph.root.paymentId} FOR UPDATE`;
    const row=await tx.receiptReallocation.findFirst({where:{id,...scoped(scope)}});if(!row||row.status!=="PENDING_APPROVAL"||row.revision!==revision)throw Error("REALLOCATION_STATE");
    await requireCurrentFinanceAuthority(tx,scope,["adjustments.view","billing.view",action==="cancel"?"adjustments.request":"adjustments.approve"],row.facilityId);
    if(action!=="approve"){
      await tx.receiptReallocation.update({where:{id},data:{status:final,revision:{increment:1},reviewedById:scope.userId,reviewedAt:new Date(),reviewReference:reference}});await audit(tx,scope,row,action,{reference,fingerprint:row.fingerprint});return {id,status:final,idempotent:false};
    }
    const c=await context(tx,scope,input,id);sameLocks(c.graph.accountIds,locked);
    if(c.fingerprint!==row.fingerprint||row.paymentId!==c.graph.root.paymentId)throw Error("REALLOCATION_CHANGED");
    const now=new Date(),amount=receiptAmount(c.plan.amountCents),metadata={receiptReallocationId:id,rootPaymentId:row.paymentId,operation:row.operation};
    const outgoing=await tx.ledgerEntry.create({data:{accountId:row.sourceAccountId,type:"REVERSAL",amount,taxAmount:0,reversalOfId:row.sourceEntryId,description:`Receipt allocation ${row.operation.toLowerCase()} ${id}`,effectiveAt:now,externalRef:`receipt-reallocation:${id}:out`,metadata,createdById:scope.userId}});
    const incoming=await tx.ledgerEntry.create({data:{accountId:row.targetAccountId,type:c.plan.incoming.type,amount,taxAmount:0,reversalOfId:"reversalOfId" in c.plan.incoming?c.plan.incoming.reversalOfId:null,description:`Receipt allocation ${row.operation.toLowerCase()} ${id}`,effectiveAt:now,externalRef:`receipt-reallocation:${id}:in`,metadata,createdById:scope.userId}});
    await tx.account.update({where:{id:row.sourceAccountId},data:{balance:{increment:amount}}});await tx.account.update({where:{id:row.targetAccountId},data:{balance:{decrement:amount}}});
    const source=await correctionDocument(tx,id,"source",row.sourceAccountId,c.plan.amountCents,c.snapshot.source.balance,c.plan.sourceBalanceAfterCents,row.reason,row.evidenceReference,reference,row.paymentId,row.operation);
    const target=await correctionDocument(tx,id,"target",row.targetAccountId,c.plan.amountCents,c.snapshot.target.balance,c.plan.targetBalanceAfterCents,row.reason,row.evidenceReference,reference,row.paymentId,row.operation);
    const changed=await tx.receiptReallocation.updateMany({where:{id,status:"PENDING_APPROVAL",revision},data:{status:"POSTED",revision:{increment:1},reviewedById:scope.userId,reviewedAt:now,reviewReference:reference,postedById:scope.userId,postedAt:now,sourceLedgerEntryId:outgoing.id,targetLedgerEntryId:incoming.id,sourceDocumentId:source.id,targetDocumentId:target.id}});if(changed.count!==1)throw Error("REALLOCATION_STATE");
    await audit(tx,scope,row,"posted",{fingerprint:row.fingerprint,sourceLedgerEntryId:outgoing.id,targetLedgerEntryId:incoming.id,sourceDocumentId:source.id,targetDocumentId:target.id,originalPaymentUnchanged:true});
    await receiptAllocationGraph(tx,scope,row.paymentId,[row.sourceAccountId,row.targetAccountId],id);
    return {id,status:"POSTED",idempotent:false};
  },{isolationLevel:"Serializable",timeout:30000});
}

// Preserve the same request/decision and recheck every locked source proof.
// Only confirmed DB rollbacks repeat the complete locked financial decision.
// Provider calls, timeouts and unknown commit outcomes are never replayed.
export const requestReceiptReallocation=(scope:RequestScope,input:ReceiptReallocationInput,fingerprint:string)=>retryRolledBackFinanceTransaction(()=>requestReceiptReallocationOnce(scope,input,fingerprint));
export const decideReceiptReallocation=(scope:RequestScope,id:string,revision:number,action:"approve"|"reject"|"cancel",reference:string)=>retryRolledBackFinanceTransaction(()=>decideReceiptReallocationOnce(scope,id,revision,action,reference));
