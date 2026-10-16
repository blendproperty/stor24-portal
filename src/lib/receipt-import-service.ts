import {createHash,randomUUID} from 'node:crypto';
import {Prisma} from '@/generated/prisma/client';
import {z} from 'zod';
import {db} from './db';
import type {RequestScope} from './scope';
import {currentReceiptImportProof} from './unidentified-receipt-service';
import {receiptImportAuthority} from './receipt-import-access';
import {approvedReceiptBankSource} from './receipt-bank-source-service';
import {receiptSourceHash} from './receipt-bank-source-policy';
import {receiptPostingInputSchema,importedReceiptMethod,sealReceiptPostingPreview,readReceiptPostingPreview,assertReceiptPostingPreviewCurrent,RECEIPT_POSTING_TERMS,type ReceiptPostingPreview} from './receipt-import-policy';
import {buildAccountStatement} from './finance/account-statement';
import {documentShellHtml,escapeHtml,formatZar} from './finance/billing-document-brand';
import {units} from './settlement-policy';
import {retainImportedSettlementMatch} from './settlement-service';
import {bankReceiptSource,netcashReceiptSource} from './receipt-import-source';
import {decryptIntegrationSecret} from './integrations/integration-secret-vault';

type Tx=Prisma.TransactionClient;
const permissions=['receipt_review.view','receipt_review.post','receipt_review.approve','ledger.view','payments.manage','billing.view'];
const hash=receiptSourceHash,json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
type Input=ReturnType<typeof receiptPostingInputSchema.parse>;
async function context(tx:Tx,scope:RequestScope,input:Input){
 await receiptImportAuthority(tx,scope,permissions,input.facilityId);
 const item=await tx.unidentifiedReceiptIntake.findFirst({where:{id:input.intakeId,organisationId:scope.organisationId,facilityId:input.facilityId},include:{proposals:{orderBy:[{createdAt:'desc'},{id:'desc'}]}}});
 if(!item||item.status!=='REVIEWED'||item.sourceEnvironment!=='live'||!item.sourceId||item.sourceType==='MANUAL_REPORTED')throw Error('RECEIPT_POSTING_SOURCE_REVIEW');
 const proposal=item.proposals.find(p=>p.id===input.proposalId&&p.status==='REVIEWED');
 if(!proposal?.reviewedById||!proposal.reviewedAt||!proposal.reviewReference||proposal.sourceFingerprint!==item.sourceFingerprint)throw Error('RECEIPT_POSTING_SOURCE_REVIEW');
 if([item.capturedById,proposal.proposedById].includes(scope.userId)||[item.capturedById,proposal.proposedById].includes(proposal.reviewedById))throw Error('RECEIPT_REVIEW_INDEPENDENT');
 const review=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:item.facilityId,entityType:'UnidentifiedReceiptIntake',entityId:item.id,actorId:proposal.reviewedById,action:'receipt_review.reviewed'},orderBy:{occurredAt:'desc'}});
 if(!review||object(review.after).proposalId!==proposal.id||object(review.after).revision!==item.revision||object(review.after).reference!==proposal.reviewReference)throw Error('RECEIPT_POSTING_SOURCE_REVIEW');
 const source=await currentReceiptImportProof(tx,scope,item);
 const account=await tx.account.findFirst({where:{id:proposal.accountId,currency:'ZAR',customer:{organisationId:scope.organisationId},tenancy:{facilityId:item.facilityId,facility:{organisationId:scope.organisationId}}},include:{customer:true,tenancy:true}});
 if(!account?.tenancy||account.tenancy.customerId!==account.customerId)throw Error('RECEIPT_REVIEW_ACCOUNT');
 await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${account.id} FOR UPDATE`;
 const currentAccount=await tx.account.findUniqueOrThrow({where:{id:account.id}});
 const evidence={accountId:account.id,accountNumber:account.accountNumber,customerId:account.customerId,customer:account.customer.companyName||`${account.customer.firstName} ${account.customer.lastName}`,facilityId:item.facilityId,tenancyId:account.tenancy.id,tenancyStatus:account.tenancy.status,balance:currentAccount.balance.toString(),updatedAt:currentAccount.updatedAt.toISOString()};
 // Existing matching proposals retain their original insertion-order hash.
 if(createHash('sha256').update(JSON.stringify(evidence)).digest('hex')!==proposal.accountFingerprint)throw Error('RECEIPT_REVIEW_CHANGED');
 const entries=await tx.ledgerEntry.findMany({where:{accountId:account.id},orderBy:[{effectiveAt:'asc'},{id:'asc'}],take:5001});
 if(entries.length>5000||entries.some(e=>e.effectiveAt>new Date()))throw Error('RECEIPT_POSTING_ACCOUNT_REVIEW');
 const balance=buildAccountStatement(entries.map(e=>({...e,amount:e.amount.toString()})),new Date(0),new Date('9999-01-01')).closingBalance;
 if(units(balance)!==units(currentAccount.balance.toString()))throw Error('RECEIPT_POSTING_ACCOUNT_REVIEW');
 if(await tx.payment.count({where:{accountId:account.id,OR:[{environment:'sandbox'},{status:{in:['TEST_PENDING','TEST_SUCCEEDED','PENDING']}},{idempotencyKey:{contains:'test',mode:'insensitive'}},{idempotencyKey:{contains:'sandbox',mode:'insensitive'}},{idempotencyKey:{contains:'simulat',mode:'insensitive'}}]}})||await tx.financialAdjustment.count({where:{accountId:account.id,status:{in:['PENDING_APPROVAL','APPROVED']}}})||await tx.receiptReallocation.count({where:{OR:[{sourceAccountId:account.id},{targetAccountId:account.id}],status:'PENDING_APPROVAL'}}))throw Error('RECEIPT_POSTING_ACCOUNT_REVIEW');
 let bankSourceId:string|null=null,bankApprovalAuditId:string|null=null,merchantKey:string|null=null,code:string|undefined;
 if(item.sourceType==='BANK_IMPORT_ENTRY'){
  const entry=await tx.settlementBankEntry.findUniqueOrThrow({where:{id:item.sourceId},include:{import:true}});
  if(!entry.import.receiptBankSourceId||object(source.evidence).currencyBasis!=='NORMALISED_SOURCE_DECLARED_ZAR')throw Error('RECEIPT_POSTING_BANK_MAPPING');
  const bank=await approvedReceiptBankSource(tx,scope.organisationId,entry.import.receiptBankSourceId);
  if(entry.import.receiptBankIdentitySignature!==bank.identitySignature||entry.bankKey!==hash([scope.organisationId,'live','bank-source',bank.bankIdentityHash]))throw Error('RECEIPT_POSTING_BANK_MAPPING');
  bankSourceId=bank.id;bankApprovalAuditId=bank.approvalAuditId;
 }else{
  const line=await tx.settlementLine.findUniqueOrThrow({where:{id:item.sourceId},include:{statement:true}});
  if(line.statement.status!=='DRAFT')throw Error('RECEIPT_POSTING_SOURCE_REVIEW');
  merchantKey=line.merchantKey;code=line.code;
 }
 const method=importedReceiptMethod(item.sourceType,code);
 const snapshot={termsVersion:RECEIPT_POSTING_TERMS,input,item:{id:item.id,revision:item.revision,sourceType:item.sourceType,sourceId:item.sourceId,sourceIdentity:item.sourceIdentity,sourceFingerprint:item.sourceFingerprint,amount:item.amount.toFixed(2),currency:item.currency,receiptDate:item.receiptDate,capturedById:item.capturedById},proposal:{id:proposal.id,accountId:proposal.accountId,accountFingerprint:proposal.accountFingerprint,proposedById:proposal.proposedById,reviewedById:proposal.reviewedById,reviewReference:proposal.reviewReference,reviewAuditId:review.id},source:source.evidence,account:evidence,ledgerFingerprint:hash(entries),bankSourceId,bankApprovalAuditId,merchantKey,method};
 return{item,proposal,source,account,currentAccount,method,bankSourceId,merchantKey,snapshot,fingerprint:hash(snapshot)};
}
export async function previewImportedReceiptPosting(scope:RequestScope,raw:unknown){
 const input=receiptPostingInputSchema.parse(raw);
 return db.$transaction(async tx=>{
  const c=await context(tx,scope,input),now=new Date();
  return sealReceiptPostingPreview({...input,version:1,termsVersion:RECEIPT_POSTING_TERMS,organisationId:scope.organisationId,userId:scope.userId,accountId:c.account.id,accountNumber:c.account.accountNumber,sourceIdentity:c.item.sourceIdentity,sourceFingerprint:c.item.sourceFingerprint,amount:c.item.amount.toFixed(2),currency:'ZAR',receiptDate:c.item.receiptDate,method:c.method,fingerprint:c.fingerprint,preparedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()});
 },{isolationLevel:'RepeatableRead',timeout:30000});
}
/** Validate retained financial evidence without reinterpreting the now-linked
 * source as an available intake. Later legitimate refunds/corrections remain separate. */
export async function importedReceiptPostingEvidence(tx:Tx,organisationId:string,intakeId:string){
 const row=await tx.receiptImportPosting.findFirst({where:{organisationId,intakeId},include:{payment:true,ledgerEntry:true,document:true,intake:true,proposal:true}});
 if(!row)return null;
 const snapshot=object(row.snapshot),item=object(snapshot.item),account=object(snapshot.account),proposal=object(snapshot.proposal);
 const audit=await tx.auditEvent.findFirst({where:{organisationId,facilityId:row.facilityId,entityType:'ReceiptImportPosting',entityId:row.id,action:'receipt_import.posted',actorId:row.postedById}});
 if(hash(snapshot)!==row.snapshotHash||row.intake.status!=='POSTED'||row.intake.sourceIdentity!==row.sourceIdentity||row.intake.sourceFingerprint!==row.sourceFingerprint||row.proposalId!==proposal.id||row.accountId!==account.accountId||row.payment.accountId!==row.accountId||row.ledgerEntry.accountId!==row.accountId||row.ledgerEntry.type!=='PAYMENT'||!row.ledgerEntry.amount.equals(row.amount)||!row.payment.amount.equals(row.amount)||row.payment.currency!=='ZAR'||row.payment.environment!=='live'||row.payment.provider!==(row.bankEntryId?'BANK_IMPORT':'NETCASH_STATEMENT')||row.payment.idempotencyKey!==`imported-receipt:${organisationId}:${row.sourceIdentity}`||object(row.ledgerEntry.metadata).paymentId!==row.paymentId||object(row.ledgerEntry.metadata).receiptImportPostingId!==row.id||row.ledgerEntry.effectiveAt.getTime()!==new Date(`${row.originalReceiptDate}T00:00:00+02:00`).getTime()||row.document.tenancyId!==account.tenancyId||!row.document.content||createHash('sha256').update(row.document.content).digest('hex')!==row.document.sha256||!audit||object(audit.after).snapshotHash!==row.snapshotHash||object(audit.after).paymentId!==row.paymentId||item.amount!==row.amount.toFixed(2))throw Error('RECEIPT_POSTING_EVIDENCE_REVIEW');
 if(row.bankEntryId){
  const bank=await tx.settlementBankEntry.findUniqueOrThrow({where:{id:row.bankEntryId},include:{import:true}});
  if(!bank.active||bank.import.status!=='ACTIVE'||bank.import.organisationId!==organisationId||bank.import.environment!=='live'||bank.bankKey!==object(snapshot.source).bankKey||bank.import.sha256!==object(snapshot.source).sha256||bank.import.receiptBankSourceId!==row.bankSourceId||bank.date!==row.originalReceiptDate||!bank.amount.equals(row.amount))throw Error('RECEIPT_POSTING_EVIDENCE_REVIEW');
  bankReceiptSource(decryptIntegrationSecret(bank.import.rawEncrypted),bank.import.sha256,{...bank,amount:bank.amount.toString()});
 }else if(row.netcashLineId){
  const line=await tx.settlementLine.findUniqueOrThrow({where:{id:row.netcashLineId},include:{statement:true}});
  if(!line.active||line.statement.status==='VOID'||line.statement.organisationId!==organisationId||line.statement.environment!=='live'||line.statement.sha256!==object(snapshot.source).sha256||line.paymentId!==row.paymentId||line.date!==row.originalReceiptDate||!line.amount.equals(row.amount)||line.merchantKey!==snapshot.merchantKey)throw Error('RECEIPT_POSTING_EVIDENCE_REVIEW');
  netcashReceiptSource(decryptIntegrationSecret(line.statement.rawEncrypted),line.statement.sha256,{date:line.statement.date,opening:line.statement.opening.toString(),closing:line.statement.closing.toString()},{...line,amount:line.amount.toString(),vat:line.vat.toString()});
 }else throw Error('RECEIPT_POSTING_EVIDENCE_REVIEW');
 return{id:row.id,paymentId:row.paymentId,ledgerEntryId:row.ledgerEntryId,documentId:row.documentId,accountId:row.accountId,sourceIdentity:row.sourceIdentity,sourceFingerprint:row.sourceFingerprint,amount:row.amount.toFixed(2),originalReceiptDate:row.originalReceiptDate,postedAt:row.postedAt.toISOString(),postedById:row.postedById,approvalReference:row.approvalReference,paymentStatus:row.payment.status,snapshotHash:row.snapshotHash};
}
export async function postImportedReceipt(scope:RequestScope,raw:unknown,requestKey:string){
 const parsed=readReceiptPostingPreview(raw,{organisationId:scope.organisationId,userId:scope.userId,facilityId:object(raw).facilityId as string});
 z.uuid().parse(requestKey);
 const requestHash=hash({preview:parsed,requestKey});
 const recover=async(tx:Tx)=>{
  const row=await tx.receiptImportPosting.findUnique({where:{organisationId_requestKey:{organisationId:scope.organisationId,requestKey}}});
  if(!row)return null;
  await receiptImportAuthority(tx,scope,permissions,row.facilityId);
  if(row.requestHash!==requestHash||row.postedById!==scope.userId||row.intakeId!==parsed.intakeId)throw Error('RECEIPT_POSTING_CHANGED');
  return{posting:await importedReceiptPostingEvidence(tx,scope.organisationId,row.intakeId),idempotent:true};
 };
 try{return await db.$transaction(async tx=>{
  await receiptImportAuthority(tx,scope,permissions,parsed.facilityId);
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id"=${scope.organisationId} FOR UPDATE`;
  const existing=await recover(tx);if(existing)return existing;
  assertReceiptPostingPreviewCurrent(parsed,new Date());
  const input=receiptPostingInputSchema.parse(Object.fromEntries(Object.keys(receiptPostingInputSchema.shape).map(k=>[k,parsed[k as keyof ReceiptPostingPreview]])));
  const c=await context(tx,scope,input);
  if(c.fingerprint!==parsed.fingerprint||c.account.id!==parsed.accountId||c.account.accountNumber!==parsed.accountNumber||c.item.sourceIdentity!==parsed.sourceIdentity||c.item.sourceFingerprint!==parsed.sourceFingerprint||c.item.amount.toFixed(2)!==parsed.amount||c.method!==parsed.method||c.item.receiptDate!==parsed.receiptDate)throw Error('RECEIPT_POSTING_CHANGED');
  const id=randomUUID(),amount=c.item.amount,receiptAt=new Date(`${c.item.receiptDate}T00:00:00+02:00`),now=new Date();
  const payment=await tx.payment.create({data:{accountId:c.account.id,status:'SUCCEEDED',amount,currency:'ZAR',method:c.method,provider:c.bankSourceId?'BANK_IMPORT':'NETCASH_STATEMENT',environment:'live',providerOrganisationId:scope.organisationId,providerFacilityId:c.item.facilityId,providerMerchantKey:c.merchantKey,idempotencyKey:`imported-receipt:${scope.organisationId}:${c.item.sourceIdentity}`,processedAt:receiptAt}});
  const ledger=await tx.ledgerEntry.create({data:{accountId:c.account.id,type:'PAYMENT',amount,taxAmount:0,description:`Imported receipt (${c.method})`,effectiveAt:receiptAt,externalRef:payment.idempotencyKey,createdById:scope.userId,metadata:{paymentId:payment.id,receiptImportPostingId:id,sourceIdentity:c.item.sourceIdentity,environment:'live',verification:'INDEPENDENT_ORIGINAL_SOURCE_REVIEW',originalReceiptDate:c.item.receiptDate,datePrecision:'DATE_ONLY'}}});
  const after=c.currentAccount.balance.minus(amount);
  await tx.account.update({where:{id:c.account.id},data:{balance:after}});
  const content=documentShellHtml({title:'Receipt',preheader:'Receipt retained from reviewed original evidence',bodyHtml:`<h1>Receipt</h1><p>Reference: ${escapeHtml(id)}</p><p>Account: ${escapeHtml(c.account.accountNumber)}</p><p>Amount received: ${formatZar(amount.toFixed(2))}</p><p>Original receipt date: ${escapeHtml(c.item.receiptDate)} (date only)</p><p>Recorded: ${escapeHtml(now.toISOString())}</p><p>Method: ${escapeHtml(c.method)}</p><p>Balance before: ${formatZar(c.currentAccount.balance.toFixed(2))} · Balance after: ${formatZar(after.toFixed(2))}</p><p>Independent review: ${escapeHtml(parsed.approvalReference)}</p><p>This records a receipt confirmed against retained original evidence. It does not initiate a payment or confirm a separate bank payout. Later approved corrections remain separate.</p>`});
  const sha256=createHash('sha256').update(content).digest('hex');
  const document=await tx.document.create({data:{tenancyId:c.account.tenancy!.id,type:'RECEIPT',status:'GENERATED',content,sha256,storageKey:`inline:${sha256}`,externalId:`IR-${id}`,idempotencyKey:`receipt-import:${id}:document`}});
  const row=await tx.receiptImportPosting.create({data:{id,organisationId:scope.organisationId,facilityId:c.item.facilityId,intakeId:c.item.id,proposalId:c.proposal.id,accountId:c.account.id,paymentId:payment.id,ledgerEntryId:ledger.id,documentId:document.id,bankSourceId:c.bankSourceId,sourceIdentity:c.item.sourceIdentity,sourceFingerprint:c.item.sourceFingerprint,bankEntryId:c.bankSourceId?c.item.sourceId:null,netcashLineId:c.bankSourceId?null:c.item.sourceId,amount,currency:'ZAR',originalReceiptDate:c.item.receiptDate,snapshot:json(c.snapshot),snapshotHash:c.fingerprint,requestKey,requestHash,postedById:scope.userId,approvalReference:parsed.approvalReference,postedAt:now}});
  await tx.unidentifiedReceiptIntake.update({where:{id:c.item.id},data:{status:'POSTED',revision:{increment:1}}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:c.item.facilityId,actorId:scope.userId,entityType:'Payment',entityId:payment.id,action:'payment.posted',after:{receiptImportPostingId:row.id,ledgerEntryId:ledger.id,documentId:document.id,sourceIdentity:c.item.sourceIdentity,originalReceiptDate:c.item.receiptDate,datePrecision:'DATE_ONLY',providerCall:false}}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:c.item.facilityId,actorId:scope.userId,entityType:'ReceiptImportPosting',entityId:row.id,action:'receipt_import.posted',after:{snapshotHash:c.fingerprint,paymentId:payment.id,ledgerEntryId:ledger.id,documentId:document.id,sourceIdentity:c.item.sourceIdentity,approvalReference:parsed.approvalReference,providerCall:false}}});
  if(!c.bankSourceId)await retainImportedSettlementMatch(tx,scope,c.item.sourceId!,payment.id,parsed.approvalReference,requestKey);
  return{posting:await importedReceiptPostingEvidence(tx,scope.organisationId,c.item.id),idempotent:false};
 },{isolationLevel:'Serializable',timeout:30000});}catch(error){
  // Never replay a failed financial callback. A single read of the exact
  // actor-bound request may prove an already committed outcome (including a
  // lost response or a competing same-key transaction). Missing/failed read
  // preserves the original error and requires staff to reload saved history.
  try{const existing=await recover(db);if(existing)return existing;}catch{ /* retain original failure */ }
  throw error;
 }
}
export async function importedReceiptDocument(scope:RequestScope,intakeId:string){
 return db.$transaction(async tx=>{
  const posting=await tx.receiptImportPosting.findFirst({where:{intakeId,organisationId:scope.organisationId}});
  if(!posting)throw Error('RECEIPT_POSTING_NOT_FOUND');
  await receiptImportAuthority(tx,scope,['receipt_review.view','ledger.view'],posting.facilityId);
  await importedReceiptPostingEvidence(tx,scope.organisationId,intakeId);
  const document=await tx.document.findUniqueOrThrow({where:{id:posting.documentId}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:posting.facilityId,actorId:scope.userId,entityType:'Document',entityId:document.id,action:'receipt_import.document_read',after:{postingId:posting.id,sha256:document.sha256}}});
  return{content:document.content!,sha256:document.sha256!,facilityId:posting.facilityId,documentId:document.id};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
