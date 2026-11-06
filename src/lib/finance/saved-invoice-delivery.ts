import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { emailProvider, type EmailProvider } from "@/lib/email";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { privacyHash } from "@/lib/request-security";

export async function sendSavedInvoice(scope: RequestScope, id: string, requestId: string, expectedEmail: string, allowNotice: boolean, provider: EmailProvider = emailProvider()) {
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`;
    const doc = await tx.document.findFirst({where:{id,type:"INVOICE",status:{in:["GENERATED","SENT"]},OR:[{idempotencyKey:{startsWith:"monthly-invoice:"}},{idempotencyKey:{startsWith:"multi-month-invoice:"}}],tenancy:{facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}}},include:{tenancy:{include:{customer:true}}}});
    if (!doc || !doc.content || !doc.sha256 || createHash("sha256").update(doc.content).digest("hex") !== doc.sha256) throw new Error("INVOICE_DELIVERY_REVIEW");
    const customer = doc.tenancy.customer, email = customer.email?.trim();
    if (!email || email.toLowerCase() !== expectedEmail.trim().toLowerCase()) throw new Error("INVOICE_RECIPIENT_CHANGED");
    if (doc.tenancy.status === "NOTICE_GIVEN" && !allowNotice) throw new Error("INVOICE_NOTICE_REVIEW");
    const key = `saved-invoice-send:${id}:${requestId}`;
    const existing = await tx.communicationLog.findUnique({where:{idempotencyKey:key}});
    if (existing) { if (existing.status === "SUCCEEDED" && existing.recipientHash === privacyHash(email)) return {sent:true as const,logId:existing.id}; throw new Error("INVOICE_DELIVERY_REVIEW"); }
    const unresolved = await tx.communicationLog.findFirst({where:{idempotencyKey:{startsWith:`saved-invoice-send:${id}:`},status:{in:["PENDING","PROCESSING","FAILED"]}},select:{id:true}});
    if (unresolved) throw new Error("INVOICE_DELIVERY_REVIEW");
    const log = await tx.communicationLog.create({data:{organisationId:scope.organisationId,facilityId:doc.tenancy.facilityId,customerId:customer.id,channel:"EMAIL",direction:"OUTBOUND",messageType:"INVOICE",recipientHash:privacyHash(email),idempotencyKey:key,status:"PENDING",metadata:{documentId:id,invoiceNumber:doc.externalId,noticeConfirmed:allowNotice}}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:doc.tenancy.facilityId,actorId:scope.userId,action:"billing.invoice_delivery_requested",entityType:"Document",entityId:id,after:{communicationLogId:log.id,noticeConfirmed:allowNotice}}});
    return {sent:false as const,logId:log.id,email,html:doc.content,number:doc.externalId || "Invoice",customerId:customer.id,facilityId:doc.tenancy.facilityId,tenancyId:doc.tenancy.id};
  },{isolationLevel:"Serializable",timeout:20000});
  if (claim.sent) return {accepted:true,logId:claim.logId};
  try {
    const current = await db.customer.findFirst({where:{id:claim.customerId,organisationId:scope.organisationId},select:{email:true}});
    if (current?.email?.trim().toLowerCase() !== claim.email.toLowerCase()) throw new Error("RECIPIENT_CHANGED");
    const currentTenancy=await db.tenancy.findUnique({where:{id:claim.tenancyId},select:{status:true}});
    if (!currentTenancy || (currentTenancy.status === "NOTICE_GIVEN" && !allowNotice)) throw new Error("NOTICE_REVIEW");
    await provider.send({to:claim.email,subject:`Invoice ${claim.number} from Stor24`,text:`Please see invoice ${claim.number} below.`,html:claim.html,dlp:{organisationId:scope.organisationId,facilityId:claim.facilityId,actorId:scope.userId,resourceId:id,approvedRecipient:claim.email}});
    await db.$transaction(async tx => { await tx.communicationLog.update({where:{id:claim.logId},data:{status:"SUCCEEDED",sentAt:new Date()}}); await tx.document.update({where:{id},data:{status:"SENT",sentAt:new Date()}}); await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:claim.facilityId,actorId:scope.userId,action:"billing.invoice_delivery_accepted",entityType:"Document",entityId:id,after:{communicationLogId:claim.logId}}}); });
    return {accepted:true,logId:claim.logId};
  } catch {
    // A provider may have accepted before a timeout; keep the durable claim for review.
    throw new Error("INVOICE_DELIVERY_REVIEW");
  }
}
