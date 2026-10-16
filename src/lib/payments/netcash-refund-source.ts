import type {Prisma} from '@/generated/prisma/client';
import type {RequestScope} from '@/lib/scope';
import {approvedRefundAdjustmentSource} from '@/lib/adjustment-service';
import {netcashReceiptSource} from '@/lib/receipt-import-source';
import {decryptIntegrationSecret} from '@/lib/integrations/integration-secret-vault';
import {decryptNetcashConfig} from './netcash-client';
import {merchantIdentity} from './netcash-statement';
import {isTestPayment} from './payment-evidence';
import {refundSourceSchema,refundTransactionId,requireOriginalRefundReceiptProof} from './netcash-refund-policy';
/** Read only. Numeric identity comes solely from an exact checksum-verified PNC
 * row linked to the original payment in an independently reviewed statement.
 * Legacy merchant inference and amount-only matching are deliberately refused. */
export async function currentNetcashRefundSource(tx:Prisma.TransactionClient,scope:RequestScope,input:{adjustmentId:string;lineId:string}){
 const{request,reviewed}=await approvedRefundAdjustmentSource(tx,scope,input.adjustmentId);
 const line=await tx.settlementLine.findFirst({where:{id:input.lineId,active:true,paymentId:request.paymentId,code:'PNC',kind:'RECEIPT',statement:{organisationId:scope.organisationId,status:'REVIEWED',environment:'live'}},include:{statement:true}});
 if(!line||!line.resolutionHash||!line.resolvedById||!line.reference)throw Error('NETCASH_REFUND_ORIGINAL_RECEIPT_REQUIRED');
 const statement=line.statement;
 if(!statement.approvedById||!statement.approvedAt||!statement.approvalReference||[statement.importedById,statement.editedById,line.resolvedById].includes(statement.approvedById)||line.merchantKey!==statement.merchantKey)throw Error('NETCASH_REFUND_STATEMENT_REVIEW');
 refundTransactionId(line.transactionId);
 if(await tx.settlementLine.count({where:{active:true,merchantKey:statement.merchantKey,transactionId:line.transactionId,statement:{organisationId:scope.organisationId,status:{not:'VOID'}}}})!==1)throw Error('NETCASH_REFUND_ORIGINAL_RECEIPT_REQUIRED');
 const original=await tx.payment.findFirst({where:{id:request.paymentId!,accountId:request.accountId,provider:'NETCASH',environment:'live',currency:'ZAR',status:{in:['SUCCEEDED','PARTIALLY_REFUNDED']}},include:{account:{select:{customerId:true}},merchandiseOrder:{select:{id:true}}}});
 if(!original||original.merchandiseOrder||isTestPayment(original)||!original.providerMerchantKey||original.providerMerchantKey!==statement.merchantKey||!original.amount.equals(line.amount))throw Error('NETCASH_REFUND_ORIGINAL_RECEIPT_REQUIRED');
 const snapshot=line.resolutionSnapshot as {proof?:unknown}|null;
 requireOriginalRefundReceiptProof(snapshot?.proof,line.resolutionHash,{paymentId:original.id,merchantKey:statement.merchantKey,sourceEntryId:request.sourceEntryId!,paymentAmount:original.amount.toString()});
 netcashReceiptSource(decryptIntegrationSecret(statement.rawEncrypted),statement.sha256,{date:statement.date,opening:statement.opening.toString(),closing:statement.closing.toString()},{transactionId:line.transactionId,date:line.date,code:line.code,description:line.description,amount:line.amount.toString(),vat:line.vat.toString(),extras:line.extras,kind:line.kind});
 const approval=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,entityType:'SettlementStatement',entityId:statement.id,action:{in:['settlement.approve','settlement.reopen','settlement.void']}},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
 const approved=approval?.after as {reference?:unknown;sourceHash?:unknown}|null;
 if(approval?.action!=='settlement.approve'||approval.actorId!==statement.approvedById||approved?.reference!==statement.approvalReference||approved.sourceHash!==statement.sha256)throw Error('NETCASH_REFUND_STATEMENT_REVIEW');
 const connection=await tx.integrationConnection.findFirst({where:{id:statement.connectionId,organisationId:scope.organisationId,provider:'NETCASH',category:'PAYMENTS',status:{in:['CONNECTED','HEALTHY']},OR:[{facilityId:null},{facilityId:request.facilityId}]}});
 if(!connection||(connection.config as {environment?:unknown}).environment!=='live')throw Error('NETCASH_REFUND_MERCHANT_REVIEW');
 const config=decryptNetcashConfig(connection.config);
 if(config.environment!=='live'||!config.merchantAccount||merchantIdentity(scope.organisationId,'live',config.merchantAccount)!==statement.merchantKey)throw Error('NETCASH_REFUND_MERCHANT_REVIEW');
 return refundSourceSchema.parse({organisationId:scope.organisationId,facilityId:request.facilityId,accountId:request.accountId,customerId:original.account.customerId,adjustmentId:request.id,adjustmentFingerprint:reviewed.fingerprint,adjustmentRequestedById:request.requestedById,adjustmentReviewedById:request.reviewedById!,adjustmentReviewedAt:request.reviewedAt!.toISOString(),paymentId:original.id,sourceEntryId:request.sourceEntryId!,paymentAmount:original.amount.toFixed(2),refundAmount:request.amount.toFixed(2),merchantKey:statement.merchantKey,connectionId:connection.id,connectionUpdatedAt:connection.updatedAt.toISOString(),statementId:statement.id,statementSha256:statement.sha256,statementRevision:statement.revision,statementApprovedById:statement.approvedById,statementApprovalAuditId:approval.id,lineId:line.id,transactionId:line.transactionId,lineDate:line.date,lineCode:line.code,lineResolutionHash:line.resolutionHash});
}
