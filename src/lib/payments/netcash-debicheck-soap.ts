/** NIWS_NIF WSDL and TT1/Trace contracts checked 14 October 2026.
 * Authentication-envelope preparation does not submit a bank request.
 * Only the current-status operation below performs a request, and it is read-only.
 */
import {boundedBody} from "./netcash-mandate";
import {debiCheckSoapResult,debiCheckScalar as scalar,debiCheckDayOptions} from "./netcash-debicheck-response";

export const DEBICHECK_ENDPOINT="https://ws.netcash.co.za/NIWS/NIWS_NIF.svc";
const invalid=()=>{throw Error("DEBICHECK_RESPONSE_REVIEW")};
const guid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]!);
function serviceKey(value:string){if(!guid.test(value))throw Error("DEBICHECK_CONFIGURATION_REQUIRED");return value;}
function date(value:string){const parsed=new Date(`${value}T12:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error("DEBICHECK_TERMS_INVALID");return value.replaceAll("-","");}
function money(value:string){if(!/^\d{1,6}\.\d{2}$/.test(value)||Number(value)<=0)throw Error("DEBICHECK_TERMS_INVALID");return value;}
function text(value:string,max:number){if(!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error("DEBICHECK_TERMS_INVALID");return value;}
function envelope(method:string,fields:[string,string|boolean][]){return`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="http://tempuri.org/">${fields.map(([name,value])=>`<${name}>${escape(String(value))}</${name}>`).join("")}</${method}></s:Body></s:Envelope>`;}
export type DebiCheckAuthenticationTerms={accountReference:string;templateId:string;isIdNumber:boolean;debtorIdentification:string;accountName:string;bankAccountName:string;branchCode:string;bankAccountNumber:string;bankAccountType:"Current"|"Savings"|"Transmission";mobileNumber:string;emailAddress:string;collectionAmount:string;firstCollectionDiffers:boolean;firstCollectionAmount:string;firstCollectionDate:string;monthlyCollectionDay:number;debtorIdentificationCode:"P"|"I"|"C"};
export function debiCheckAuthenticationFields(key:string,p:DebiCheckAuthenticationTerms):[string,string|boolean][]{
 if(!/^[A-Za-z0-9_-]{1,50}$/.test(p.accountReference)||!/^NCDCT\d{9}$/.test(p.templateId)||typeof p.isIdNumber!=="boolean"||typeof p.firstCollectionDiffers!=="boolean"||!['Current','Savings','Transmission'].includes(p.bankAccountType)||!['P','I','C'].includes(p.debtorIdentificationCode)||p.isIdNumber!==(p.debtorIdentificationCode==='I')||!/^\d{6}$/.test(p.branchCode)||!/^\d{1,20}$/.test(p.bankAccountNumber)||!/^0\d{9}$/.test(p.mobileNumber)||!Number.isInteger(p.monthlyCollectionDay)||p.monthlyCollectionDay<1||p.monthlyCollectionDay>31||!/^\S+@\S+\.\S+$/.test(p.emailAddress)||p.emailAddress.length>100)throw Error("DEBICHECK_TERMS_INVALID");
 if(p.isIdNumber&&!/^\d{13}$/.test(p.debtorIdentification))throw Error("DEBICHECK_TERMS_INVALID");
 text(p.emailAddress,100);
 if(p.firstCollectionDiffers!==(Number(p.firstCollectionAmount)!==Number(p.collectionAmount)))throw Error("DEBICHECK_TERMS_INVALID");
 // WSDL enum names and sequence differ from the old REST-shaped scaffold.
 return[['ServiceKey',serviceKey(key)],['AccountReference',p.accountReference],['DebiCheckMandateTemplateId',p.templateId],['IsIdNumber',p.isIdNumber],['DebtorIdentification',text(p.debtorIdentification,50)],['AccountName',text(p.accountName,100)],['BankAccountName',text(p.bankAccountName,100)],['BranchCode',p.branchCode],['BankAccountNumber',p.bankAccountNumber],['BankAccountType',p.bankAccountType],['MobileNumber',p.mobileNumber],['EmailAddress',p.emailAddress],['CollectionAmount',money(p.collectionAmount)],['FirstCollectionDiffers',p.firstCollectionDiffers],['FirstCollectionAmount',money(p.firstCollectionAmount)],['FirstCollectionDate',date(p.firstCollectionDate)],['collectionDayCode',`MNTH_${String(p.monthlyCollectionDay).padStart(2,'0')}`],['DebtorIdentificationCode',p.debtorIdentificationCode]];
}
export function buildDebiCheckAuthenticationEnvelope(key:string,p:DebiCheckAuthenticationTerms){return envelope('DebiCheckAuthenticate',debiCheckAuthenticationFields(key,p));}
export function parseDebiCheckCurrentStatus(xml:string,expectedReference:string){
 if(!/^NC\d{12}$/.test(expectedReference))throw Error('DEBICHECK_CONTRACT_INVALID');
 const value=debiCheckSoapResult(xml,'DebiCheckAuthenticationCurrentStatus'),code=scalar(value,'ErrorCode');
 if(code!=='000'){if(['100','200','202'].includes(code??''))throw Error(`DEBICHECK_STATUS_REJECTED_${code}`);return invalid();}
 const reference=scalar(value,'ContractReference');if(reference!==expectedReference)return invalid();
 const status=scalar(value,'Status'),cancelledAt=scalar(value,'DateCancelled',true),updatedAt=scalar(value,'UpdateDate'),cancellationReason=scalar(value,'CancellationReason',true);
 if(!status)return invalid();
 for(const stamp of[updatedAt,cancelledAt])if(stamp!==null){if(!/^\d{8}$/.test(stamp))return invalid();try{date(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}`)}catch{return invalid();}}
 // Preserve unrecognised provider state for review; never enable a collection.
 return{contractReference:reference,status,updatedAt,cancelledAt,cancellationReason,bankAuthenticationObserved:status==='Accepted'&&cancelledAt===null&&cancellationReason===null,collectionAuthorised:false as const,financialReceipt:false as const};
}
export async function readDebiCheckCurrentStatus(key:string,contractReference:string,request:typeof fetch=fetch){
 serviceKey(key);if(!/^NC\d{12}$/.test(contractReference))throw Error('DEBICHECK_CONTRACT_INVALID');
 let xml:string;
 try{const response=await request(DEBICHECK_ENDPOINT,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/INIWS_NIF/DebiCheckAuthenticationCurrentStatus"'},body:envelope('DebiCheckAuthenticationCurrentStatus',[['ServiceKey',key],['ContractReference',contractReference]])});if(!response.ok)throw Error();xml=(await boundedBody(response,64000)).toString();}catch{throw Error('DEBICHECK_STATUS_UNAVAILABLE');}
 return parseDebiCheckCurrentStatus(xml,contractReference);
}
export function parseDebiCheckTemplate(xml:string,expectedTemplateId:string){
 if(!/^NCDCT\d{9}$/.test(expectedTemplateId))throw Error('DEBICHECK_TEMPLATE_INVALID');
 const value=debiCheckSoapResult(xml,'DebiCheckRetrieveMandateTemplateDetail'),code=scalar(value,'ErrorCode');
 if(code!=='000'){if(['100','200','202'].includes(code??''))throw Error(`DEBICHECK_TEMPLATE_REJECTED_${code}`);return invalid();}
 if(scalar(value,'TemplateId')!==expectedTemplateId)return invalid();
 const fields=['AdjustmentAmount','AdjustmentCategory','AdjustmentRuleIndicator','AdjustmentType','AuthenticationType','CollectionFrequency','CollectionFrequencyDayCode','DebitEntryClassCode','DebitValueType','DebtorAuthCode','DebtorAuthenticationRequired','InstallmentOccurrence','RMS','TemplateName','TrackingDayCode','TrackingIndicator'] as const;
 const detail=Object.fromEntries(fields.map(name=>[name,scalar(value,name,true)])) as Record<typeof fields[number],string|null>;
 // Preserve provider terms for explicit review; this monthly lane does not
 // reinterpret a batch/RMS template as TT1 or enable a bank request.
 if(detail.CollectionFrequency!=='MNTH'||detail.InstallmentOccurrence!=='RCUR')throw Error('DEBICHECK_TEMPLATE_MONTHLY_REVIEW');
 return{templateId:expectedTemplateId,detail,monthlyDayOptions:debiCheckDayOptions(value),authenticationSubmissionEnabled:false as const,collectionEnabled:false as const};
}
export async function readDebiCheckTemplate(key:string,templateId:string,request:typeof fetch=fetch){
 serviceKey(key);if(!/^NCDCT\d{9}$/.test(templateId))throw Error('DEBICHECK_TEMPLATE_INVALID');
 let xml:string;
 try{const response=await request(DEBICHECK_ENDPOINT,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/INIWS_NIF/DebiCheckRetrieveMandateTemplateDetail"'},body:envelope('DebiCheckRetrieveMandateTemplateDetail',[['ServiceKey',key],['DebiCheckMandateTemplateId',templateId]])});if(!response.ok)throw Error();xml=(await boundedBody(response,64000)).toString();}catch{throw Error('DEBICHECK_TEMPLATE_UNAVAILABLE');}
 return parseDebiCheckTemplate(xml,templateId);
}
