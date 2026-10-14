import {createHmac,randomUUID} from "node:crypto";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {db} from "@/lib/db";
import {requireFacility,type FacilityScope,type RequestScope} from "@/lib/scope";
import {buildAccountStatement} from "@/lib/finance/account-statement";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "@/lib/integrations/integration-secret-vault";
import {NETCASH_SOFTWARE_VENDOR_KEY} from "@/lib/integrations/netcash-configuration";
import {getNetcashConnection} from "./netcash-client";
import {merchantIdentity} from "./netcash-statement";
import {isTestPayment} from "./payment-evidence";
import {createPayNowInvoiceRequest} from "./netcash-paynow-soap";
import {parsePayNowInvoice,projectPayNowInstructions,type PrivatePayNowInvoice} from "./netcash-invoice-response";
import {CARD_SUBSCRIPTION_DOMAIN,CARD_SUBSCRIPTION_OPEN_STATUSES,cardSourceHash} from "./card-autopay-enrollment-policy";
export const PAYMENT_REQUEST_DOMAIN="NETCASH_PAYMENT_REQUEST";
type Client=Prisma.TransactionClient;
const money=z.string().regex(/^\d{1,6}\.\d{2}$/).refine(v=>Number(v)>0);
const previewSchema=z.object({version:z.literal(1),organisationId:z.string(),facilityId:z.string(),accountId:z.string(),customerId:z.string(),connectionId:z.string(),merchantHash:z.string(),environment:z.literal("sandbox"),amount:money,balance:z.string().regex(/^\d{1,12}\.\d{2}$/),sourceHash:z.string().regex(/^[a-f\d]{64}$/),nonce:z.uuid(),expiresAt:z.iso.datetime(),signature:z.string()}).strict();
export type PaymentRequestPreview=z.infer<typeof previewSchema>;
function signature(value:object){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error("PAYMENT_REQUEST_SIGNING_REQUIRED");return createHmac("sha256",key).update("netcash-account-payment-request:v1:"+cardSourceHash(value)).digest("hex");}
function sign<T extends object>(value:T){return{...value,signature:signature(value)};}
function verify<T extends {signature:string}>(value:T){const{signature:stored,...plain}=value;if(signature(plain)!==stored)throw Error("PAYMENT_REQUEST_SOURCE_REVIEW");}
async function source(client:Client,scope:FacilityScope,accountId:string,ignorePaymentId?:string,now=new Date()){
 const account=await client.account.findFirst({where:{id:accountId,customer:{organisationId:scope.organisationId}},include:{customer:{select:{id:true,organisationId:true}},tenancy:true,ledgerEntries:{orderBy:[{effectiveAt:"asc"},{id:"asc"}],take:5001}}});
 if(!account?.tenancy||account.tenancy.customerId!==account.customerId)throw Error("PAYMENT_REQUEST_ACCOUNT_NOT_FOUND");
 await requireFacility(scope,account.tenancy.facilityId);
 if(account.currency!=="ZAR"||account.ledgerEntries.length>5000||!account.ledgerEntries.length||account.ledgerEntries.some(l=>l.effectiveAt>now))throw Error("PAYMENT_REQUEST_LEDGER_REVIEW");
 const ledger=account.ledgerEntries.map(l=>({...l,amount:l.amount.toFixed(2)}));
 const payments=await client.payment.findMany({where:{accountId},select:{id:true,idempotencyKey:true,status:true,environment:true}});
 if(payments.filter(isTestPayment).some(p=>account.ledgerEntries.some(l=>l.type==="PAYMENT"&&((l.metadata as {paymentId?:unknown}|null)?.paymentId===p.id||l.externalRef===p.idempotencyKey))))throw Error("PAYMENT_REQUEST_TEST_LEDGER_REVIEW");
 const statement=buildAccountStatement(ledger,new Date(0),new Date(now.getTime()+1));
 if(statement.closingBalance!==account.balance.toFixed(2)||Number(statement.closingBalance)<=0)throw Error("PAYMENT_REQUEST_BALANCE_REVIEW");
 const pending=await client.payment.count({where:{accountId,status:{in:["PENDING","TEST_PENDING"]},...(ignorePaymentId?{id:{not:ignorePaymentId}}:{})}});
 const instructions=await client.debitOrderInstruction.count({where:{accountId,run:{status:{not:"CANCELLED"}}}});
 const subscriptions=await client.configurationProfile.count({where:{organisationId:scope.organisationId,domain:CARD_SUBSCRIPTION_DOMAIN,name:accountId,status:{in:[...CARD_SUBSCRIPTION_OPEN_STATUSES]}}});
 if(pending||instructions||subscriptions)throw Error("PAYMENT_REQUEST_COLLECTION_REVIEW");
 return{account,statement,sourceHash:cardSourceHash({accountId,customerId:account.customerId,organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,balance:account.balance.toFixed(2),currency:account.currency,tenancy:account.tenancy,ledger:JSON.parse(JSON.stringify(account.ledgerEntries))})};
}
async function connection(scope:FacilityScope,facilityId:string,required=true){
 if(required&&process.env.NETCASH_PAYMENT_REQUEST_SANDBOX_ENABLED!=="true")throw Error("PAYMENT_REQUEST_SANDBOX_DISABLED");
 const c=await getNetcashConnection(scope.organisationId,facilityId,true);const stored=await db.integrationConnection.findUniqueOrThrow({where:{id:c.id}});
 if((stored.config as {environment?:unknown}).environment!=="test"||c.config.environment!=="sandbox"||!c.config.payNowServiceKey||!c.config.merchantAccount||c.config.transactionProcessingEnabled!==true)throw Error("PAYMENT_REQUEST_SANDBOX_CONFIGURATION_REQUIRED");
 return c;
}
export async function previewAccountPaymentRequest(scope:RequestScope,accountId:string,amount?:string,now=new Date()){
 const s=await source(db,scope,accountId,undefined,now),c=await connection(scope,s.account.tenancy!.facilityId);
 const requested=money.parse(amount??s.account.balance.toFixed(2));if(Number(requested)>Number(s.account.balance))throw Error("PAYMENT_REQUEST_AMOUNT_REVIEW");
 const preview=sign({version:1 as const,organisationId:scope.organisationId,facilityId:s.account.tenancy!.facilityId,accountId,customerId:s.account.customerId,connectionId:c.id,merchantHash:merchantIdentity(scope.organisationId,"sandbox",c.config.merchantAccount!),environment:"sandbox" as const,amount:requested,balance:s.account.balance.toFixed(2),sourceHash:s.sourceHash,nonce:randomUUID(),expiresAt:new Date(now.getTime()+600000).toISOString()});
 return{preview,accountNumber:s.account.accountNumber,currency:"ZAR",purpose:"Payment towards the reviewed account balance. No new charge, automatic email or subscription is created.",statement:s.statement};
}
type Definition={version:1;preview:PaymentRequestPreview;paymentId:string;actorId:string;createdAt:string;signature:string};
function readDefinition(value:unknown,scope:FacilityScope,accountId:string){
 const raw=value as {definition?:Definition};const d=raw?.definition;if(!d||d.version!==1)throw Error("PAYMENT_REQUEST_INTEGRITY_REVIEW");verify(d);previewSchema.parse(d.preview);verify(d.preview);
 if(d.preview.accountId!==accountId||d.preview.organisationId!==scope.organisationId||!d.paymentId)throw Error("PAYMENT_REQUEST_SOURCE_REVIEW");return d;
}
export async function createAccountPaymentRequest(scope:RequestScope,input:{preview:unknown;confirmed:boolean},request:typeof fetch=fetch,now=new Date()){
 if(input.confirmed!==true)throw Error("PAYMENT_REQUEST_CONFIRMATION_REQUIRED");
 const preview=previewSchema.parse(input.preview);verify(preview);
 if(preview.organisationId!==scope.organisationId||new Date(preview.expiresAt)<=now)throw Error("PAYMENT_REQUEST_PREVIEW_EXPIRED");
 await requireFacility(scope,preview.facilityId);const c=await connection(scope,preview.facilityId);
 if(c.id!==preview.connectionId||merchantIdentity(scope.organisationId,"sandbox",c.config.merchantAccount!)!==preview.merchantHash)throw Error("PAYMENT_REQUEST_CONFIGURATION_CHANGED");
 const claim=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${preview.accountId} FOR UPDATE`;
  const idempotencyKey=`netcash-request:${scope.organisationId}:${preview.nonce}`;
  const existing=await tx.payment.findUnique({where:{idempotencyKey}});if(existing){if(existing.accountId!==preview.accountId)throw Error("PAYMENT_REQUEST_SOURCE_REVIEW");return{created:false,paymentId:existing.id};}
  const s=await source(tx,scope,preview.accountId,undefined,now);if(s.sourceHash!==preview.sourceHash||s.account.customerId!==preview.customerId||s.account.tenancy!.facilityId!==preview.facilityId||s.account.balance.toFixed(2)!==preview.balance||Number(preview.amount)>Number(preview.balance))throw Error("PAYMENT_REQUEST_SOURCE_CHANGED");
  const current=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});if(current.updatedAt.getTime()!==c.updatedAt.getTime())throw Error("PAYMENT_REQUEST_CONFIGURATION_CHANGED");
  const payment=await tx.payment.create({data:{accountId:preview.accountId,status:"TEST_PENDING",amount:preview.amount,currency:"ZAR",method:"PAY_NOW",provider:"NETCASH",environment:"sandbox",providerMerchantKey:preview.merchantHash,providerOrganisationId:scope.organisationId,providerFacilityId:preview.facilityId,idempotencyKey}});
  await tx.payment.update({where:{id:payment.id},data:{providerRef:payment.id}});
  const definition=sign({version:1 as const,preview,paymentId:payment.id,actorId:scope.userId,createdAt:now.toISOString()});
  await tx.configurationProfile.create({data:{id:`netcash-request:${payment.id}`,organisationId:scope.organisationId,facilityId:preview.facilityId,domain:PAYMENT_REQUEST_DOMAIN,name:payment.id,status:"CLAIMED",config:{definition}}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:preview.facilityId,actorId:scope.userId,action:"netcash.payment_request_claimed",entityType:"Payment",entityId:payment.id,after:{amount:preview.amount,environment:"sandbox",financialPosting:false,automaticDelivery:false}}});
  return{created:true,paymentId:payment.id};
 },{isolationLevel:"Serializable",timeout:20000});
 if(!claim.created)return readAccountPaymentRequest(scope,preview.accountId,claim.paymentId);
 let privateInvoice:PrivatePayNowInvoice|undefined,code="PAYNOW_OUTCOME_UNCERTAIN";
 try{
  const xml=await createPayNowInvoiceRequest(c.config.payNowServiceKey!,NETCASH_SOFTWARE_VENDOR_KEY,{reference:claim.paymentId,amount:preview.amount,description:"STOR24 account payment",extra1:claim.paymentId,extra2:"account-payment-request"},request);
  privateInvoice=parsePayNowInvoice(xml,{serviceKey:c.config.payNowServiceKey!,reference:claim.paymentId});
 }catch(error){if(error instanceof Error&&/^PAYNOW_REJECTED_(100|103|310)$/.test(error.message))code=error.message;}
 const accepted=!!privateInvoice,rejected=!accepted&&code.startsWith("PAYNOW_REJECTED_");
 try{await db.$transaction(async tx=>{
  const row=await tx.configurationProfile.findUniqueOrThrow({where:{id:`netcash-request:${claim.paymentId}`}});const definition=readDefinition(row.config,scope,preview.accountId);if(row.status!=="CLAIMED")throw Error("PAYMENT_REQUEST_OUTCOME_REVIEW");
  const current=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});if(current.updatedAt.getTime()!==c.updatedAt.getTime())throw Error("PAYMENT_REQUEST_CONFIGURATION_CHANGED");
  await tx.configurationProfile.update({where:{id:row.id},data:{status:accepted?"READY":rejected?"REJECTED":"UNCERTAIN",config:{definition,...(privateInvoice?{encryptedInvoice:encryptIntegrationSecret(JSON.stringify(privateInvoice))}:{outcomeCode:code})}}});
  if(rejected)await tx.payment.update({where:{id:claim.paymentId},data:{status:"FAILED",failureCode:code}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:preview.facilityId,actorId:scope.userId,action:"netcash.payment_request_outcome",entityType:"Payment",entityId:claim.paymentId,after:{status:accepted?"READY":rejected?"REJECTED":"UNCERTAIN",providerAccepted:accepted,financialPosting:false,automaticRetry:false}}});
 },{isolationLevel:"Serializable"});}catch{throw Error("PAYMENT_REQUEST_OUTCOME_REVIEW");}
 return readAccountPaymentRequest(scope,preview.accountId,claim.paymentId);
}
export async function readAccountPaymentRequest(scope:FacilityScope,accountId:string,paymentId:string){
 const p=await db.payment.findFirst({where:{id:paymentId,accountId,provider:"NETCASH",account:{customer:{organisationId:scope.organisationId}}}});
 if(!p)throw Error("PAYMENT_REQUEST_NOT_FOUND");
 const row=await db.configurationProfile.findFirst({where:{name:paymentId,domain:PAYMENT_REQUEST_DOMAIN,organisationId:scope.organisationId}});if(!row)throw Error("PAYMENT_REQUEST_NOT_FOUND");
 const d=readDefinition(row.config,scope,accountId);await requireFacility(scope,d.preview.facilityId);
 if(d.paymentId!==p.id||p.providerRef!==p.id||p.amount.toFixed(2)!==d.preview.amount||p.environment!=="sandbox"||p.providerMerchantKey!==d.preview.merchantHash||p.providerOrganisationId!==scope.organisationId||p.providerFacilityId!==d.preview.facilityId)throw Error("PAYMENT_REQUEST_SOURCE_REVIEW");
 let methods:ReturnType<typeof projectPayNowInstructions>=[],sourceCurrent=false;
 if(row.status==="READY"&&p.status==="TEST_PENDING"){
  try{const s=await source(db,scope,accountId,paymentId),c=await connection(scope,d.preview.facilityId,false);sourceCurrent=s.sourceHash===d.preview.sourceHash&&c.id===d.preview.connectionId&&merchantIdentity(scope.organisationId,"sandbox",c.config.merchantAccount!)===d.preview.merchantHash;
   if(sourceCurrent){const encrypted=(row.config as {encryptedInvoice?:string}).encryptedInvoice;if(!encrypted)throw Error();const privateInvoice=JSON.parse(decryptIntegrationSecret(encrypted)) as PrivatePayNowInvoice;if(privateInvoice.originalReference!==paymentId)throw Error();methods=projectPayNowInstructions(privateInvoice,[c.config.payNowServiceKey!,NETCASH_SOFTWARE_VENDOR_KEY]);}
  }catch{sourceCurrent=false;methods=[];}
 }
 return{paymentId,accountId,status:row.status,paymentStatus:p.status,amount:d.preview.amount,currency:"ZAR",isTest:true,sourceCurrent,methods,providerRequestAccepted:row.status==="READY"?true:row.status==="REJECTED"?false:null,financialReceipt:false,settlementVerified:false,automaticRetry:false,createdAt:d.createdAt};
}
export async function listAccountPaymentRequests(scope:FacilityScope,accountId:string){
 const account=await db.account.findFirst({where:{id:accountId,customer:{organisationId:scope.organisationId}},include:{tenancy:true}});
 if(!account?.tenancy||account.tenancy.customerId!==account.customerId)throw Error("PAYMENT_REQUEST_ACCOUNT_NOT_FOUND");await requireFacility(scope,account.tenancy.facilityId);
 const rows=await db.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,domain:PAYMENT_REQUEST_DOMAIN,name:{in:(await db.payment.findMany({where:{accountId,provider:"NETCASH",idempotencyKey:{startsWith:"netcash-request:"}},orderBy:{createdAt:"desc"},take:21,select:{id:true}})).map(p=>p.id)}},orderBy:{createdAt:"desc"},take:21});
 return{requests:await Promise.all(rows.slice(0,20).map(r=>readAccountPaymentRequest(scope,accountId,r.name))),hasMore:rows.length>20,limit:20};
}
