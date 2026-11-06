import type { Prisma } from "@/generated/prisma/client";
import { isTestPayment } from "@/lib/payments/payment-evidence";

type Database=Prisma.TransactionClient;
/** A saved initial charge and unreversed, matched receipts on this exact account are required. */
export async function legacyPaymentEvidence(tx:Database,accountId:string) {
  const account=await tx.account.findUnique({where:{id:accountId},include:{payments:{include:{merchandiseOrder:{select:{id:true}}}},ledgerEntries:true}});
  if(!account)return {requiredAmount:0,paidAmount:0,paymentIds:[],ready:false};
  const charges=account.ledgerEntries.filter(e=>e.type==="CHARGE" && ["Move-in charge","Move-in charge (pending lease signature)"].includes(e.description) && !account.ledgerEntries.some(r=>r.reversalOfId===e.id));
  const requiredCents=charges.reduce((sum,e)=>sum+Math.round(Number(e.amount)*100),0);
  const receipts=account.payments.filter(payment=>payment.status==="SUCCEEDED"&&payment.currency==="ZAR"&&payment.processedAt&&!payment.merchandiseOrder&&!isTestPayment(payment)&&account.ledgerEntries.some(entry=>{
    const metadata=entry.metadata as {paymentId?:string;verifiedStatus?:unknown;environment?:string}|null;
    const matches=payment.provider==="NETCASH"?metadata?.paymentId===payment.id&&Boolean(metadata.verifiedStatus)&&metadata.environment==="live":!payment.provider&&entry.externalRef===payment.idempotencyKey&&Boolean(entry.createdById);
    return matches&&entry.type==="PAYMENT"&&entry.amount.equals(payment.amount)&&!account.ledgerEntries.some(reversal=>reversal.reversalOfId===entry.id);
  }));
  const paidCents=receipts.reduce((sum,p)=>sum+Math.round(Number(p.amount)*100),0);
  const disputed=account.ledgerEntries.some(e=>e.type==="REFUND"||e.type==="REVERSAL");
  return {requiredAmount:requiredCents/100,paidAmount:paidCents/100,paymentIds:receipts.map(p=>p.id),ready:account.currency==="ZAR"&&Number.isSafeInteger(requiredCents)&&Number.isSafeInteger(paidCents)&&requiredCents>0&&paidCents>=requiredCents&&!disputed};
}
