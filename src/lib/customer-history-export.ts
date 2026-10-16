import { createHash } from "node:crypto";
import { canReadCollectionLetter, isCollectionLetter } from "@/lib/customer-history-body-access";
import { db } from "@/lib/db";
import { customerHistory } from "@/lib/customer-history-service";
import { requireLeasingCustomer } from "@/lib/leasing-service";
import { requirePermissionScope, type RequestScope } from "@/lib/scope";
import type { HistoryQuery, HistoryEntry } from "@/lib/customer-history-policy";
import { customerHistoryPdf, type HistoryExportRow } from "@/lib/customer-history-document";
import { customerHistoryExcel } from "@/lib/customer-history-excel";
import { toCsv } from "@/lib/reporting";
import { guardReportExport } from "@/lib/dlp-export-service";
import { guardDlpTransfer } from "@/lib/dlp-transfer-service";
import { needsProviderMessage, readHistoryMessage } from "@/lib/customer-history-message";

export function intersectHistoryScope(read: RequestScope, exported: RequestScope) {
  if(read.userId!==exported.userId||read.organisationId!==exported.organisationId)throw new Error("FORBIDDEN");
  if(exported.unrestrictedFacilities)return read;
  const facilityIds=exported.facilityIds.filter(id=>read.unrestrictedFacilities||read.facilityIds.includes(id));
  if(!facilityIds.length)throw new Error("FORBIDDEN");
  return {...read,unrestrictedFacilities:false,facilityIds};
}
const stamp=(value:string|null)=>value?new Date(value).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})+" SAST":"";
export async function buildCustomerHistoryExport(scope:RequestScope, customerId:string, query:HistoryQuery, access:{communications:RequestScope|null;collections:RequestScope|null;financial?:RequestScope|null}, selection?:{id:string;kind:string}) {
  const customer=await requireLeasingCustomer(scope,customerId);
  const entries:HistoryExportRow[]=[];let cursor:string|undefined;let legacyNotes:string|null=null;let visibility={communications:false,collections:false};
  do {
    const page=await customerHistory(scope,customerId,{...query,...(selection?{kind:selection.kind as HistoryEntry["kind"],category:undefined,search:""}:{}),cursor},{...access,write:null},selection?.id);
    legacyNotes=page.legacyNotes;visibility=page.visibility;
    for(const e of page.entries){
      if(selection&&(e.id!==selection.id||e.kind!==selection.kind))continue;
      entries.push({customerId,customerName:customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(" ")||"Customer",recordId:e.id,kind:e.kind,recordedAtUtc:e.at,recordedAtSast:stamp(e.at),store:e.facility,author:e.author,title:e.title,category:e.category,body:e.kind==="COMMUNICATION"?"":e.body,subject:"",channel:e.channel,status:e.status,sentAtSast:stamp(e.sentAt),deliveredAtSast:stamp(e.deliveredAt),readAtSast:stamp(e.readAt),evidenceLimit:e.kind==="COMMUNICATION"?"Historical log retains delivery evidence; original message text was not retained.":""});
      if(entries.length>5000)throw new Error("HISTORY_EXPORT_LIMIT");
    }
    cursor=page.nextCursor??undefined;
  }while(cursor);
  if(selection&&!entries.length)throw new Error("NOT_FOUND");
  if(!selection&&legacyNotes&&query.kind==="ALL"&&!query.category&&!query.from&&!query.to&&!query.channel&&!query.status&&(!query.search||legacyNotes.toLowerCase().includes(query.search.toLowerCase())))entries.push({customerId,customerName:customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(" ")||"Customer",recordId:"legacy-summary",kind:"LEGACY_SUMMARY",recordedAtUtc:"",recordedAtSast:"",store:"",author:"Original author not recorded",title:"Existing profile notes",category:"Undated summary",body:legacyNotes,subject:"",channel:"",status:"",sentAtSast:"",deliveredAtSast:"",readAtSast:"",evidenceLimit:"Original date and author were not recorded."});
  if(entries.length>5000)throw new Error("HISTORY_EXPORT_LIMIT");
  return {customer,rows:entries,visibility};
}
export async function hydrateCustomerHistoryMessages(input:{scope:RequestScope;customerId:string;phone:string|null;rows:HistoryExportRow[];access:{communications:RequestScope|null;collections:RequestScope|null;financial?:RequestScope|null}}) {
  const {rows}=input;
  const messages=rows.filter(row=>row.kind==="COMMUNICATION");
  const proofs=messages.length?await db.communicationLog.findMany({where:{organisationId:input.scope.organisationId,customerId:input.customerId,id:{in:messages.map(row=>String(row.recordId))}},select:{id:true,facilityId:true,provider:true,providerRef:true,recipientHash:true,channel:true,direction:true,messageType:true,metadata:true}}):[];
  const readableProofs=proofs.filter(proof=>!isCollectionLetter(proof.messageType)||canReadCollectionLetter(input.scope,input.access.communications,input.access.collections,proof.facilityId));
  const collectionBodiesReleased=readableProofs.some(proof=>isCollectionLetter(proof.messageType));
  for(const proof of proofs.filter(proof=>!readableProofs.some(allowed=>allowed.id===proof.id))){const row=rows.find(row=>row.recordId===proof.id);if(row){row.body="";row.subject="";row.evidenceLimit="Collection letter content requires collection-view access at this store.";}}
  if(readableProofs.filter(needsProviderMessage).length>50)throw new Error("HISTORY_EXPORT_LIMIT");
  for(let i=0;i<readableProofs.length;i+=8){
    await Promise.all(readableProofs.slice(i,i+8).map(async proof=>{const value=await readHistoryMessage(proof,input.phone);const row=rows.find(row=>row.recordId===proof.id);if(row){row.body=value.body;row.subject="subject" in value?(value.subject??""):"";row.evidenceLimit=value.source;}}));
  }
  return {collectionBodiesReleased};
}
export async function releaseCustomerHistoryExport(input:{scope:RequestScope;customerId:string;query:HistoryQuery;access:{communications:RequestScope|null;collections:RequestScope|null;financial?:RequestScope|null};format:"PDF"|"CSV"|"XLSX";selection?:{id:string;kind:string}}) {
  const {customer,rows,visibility}=await buildCustomerHistoryExport(input.scope,input.customerId,input.query,input.access,input.selection);
  const {collectionBodiesReleased}=await hydrateCustomerHistoryMessages({scope:input.scope,customerId:input.customerId,phone:customer.phone,rows,access:input.access});
  const decision=await guardReportExport({organisationId:input.scope.organisationId,actorId:input.scope.userId,reportKey:"customer-contact-history",rows,personalDataAllowed:true,personalColumnKeys:["customerName","customerId","body","author"],format:input.format});
  if(!decision.allowed)throw new Error("HISTORY_EXPORT_BLOCKED");
  const name=customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(" ")||"Customer";
  const summary=`Customer reference: ${customer.id} | ${rows.length} recorded entries | ${input.query.kind.toLowerCase()} | Communications: ${visibility.communications?"authorised":"restricted"} | Collections: ${visibility.collections?"authorised":"restricted"}`;
  const csv=toCsv(rows.length?rows:[{customerId:customer.id,customerName:name,recordId:"",kind:"NO_MATCHING_RECORDS",body:"No recorded history matches these filters."}]);
  const bytes=input.format==="PDF"?await customerHistoryPdf(name,rows,summary,new Date()):input.format==="XLSX"?await customerHistoryExcel(name,rows,summary,new Date()):new TextEncoder().encode("\ufeff"+csv);
  const contains=(previous:RequestScope,current:RequestScope)=>previous.userId===current.userId&&previous.organisationId===current.organisationId&&(current.unrestrictedFacilities||(!previous.unrestrictedFacilities&&previous.facilityIds.every(id=>current.facilityIds.includes(id))));
  const fresh=intersectHistoryScope(await requirePermissionScope("operations.view"),await requirePermissionScope("customer_history.export"));
  if(!contains(input.scope,fresh))throw new Error("FORBIDDEN");
  for(const [kind,permission,previous]of [["COMMUNICATION","communications.view",input.access.communications],["COLLECTION","collections.view",input.access.collections],["ACCOUNT","ledger.view",input.access.financial]] as const){
    if(previous&&(rows.some(row=>row.kind===kind)||(kind==="COLLECTION"&&collectionBodiesReleased))){
      const used=intersectHistoryScope(input.scope,previous);
      if(!contains(used,await requirePermissionScope(permission)))throw new Error("FORBIDDEN");
    }
  }
  // Inspect actual source text even for binary PDF/XLSX; keep credential/size/rate controls.
  const headers=await guardDlpTransfer({organisationId:input.scope.organisationId,actorId:input.scope.userId,resourceId:customer.id,channel:"DOWNLOAD",classification:"restricted",content:csv,byteLength:bytes.byteLength});
  await db.auditEvent.create({data:{organisationId:input.scope.organisationId,actorId:input.scope.userId,entityType:"Customer",entityId:customer.id,action:"customer.history_downloaded",after:{format:input.format,recordCount:rows.length,byteCount:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex"),permission:"customer_history.export",filters:{kind:input.query.kind,category:input.query.category??null,from:input.query.from??null,to:input.query.to??null,channel:input.query.channel??null,status:input.query.status??null,searchApplied:!!input.query.search},singleRecord:!!input.selection}}});
  return new Response(Buffer.from(bytes),{headers:{...headers,"content-type":input.format==="PDF"?"application/pdf":input.format==="XLSX"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"text/csv; charset=utf-8","content-disposition":`attachment; filename="customer-history-${customer.id}.${input.format.toLowerCase()}"`}});
}
