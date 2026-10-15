import {boundedBody} from './netcash-mandate';
import {buildDebiCheckAuthenticationEnvelope,DEBICHECK_ENDPOINT,type DebiCheckAuthenticationTerms} from './netcash-debicheck-soap';
import {debiCheckSoapResult,debiCheckScalar} from './netcash-debicheck-response';

export type DebiCheckAuthenticationOutcome={
  outcome:'BANK_AUTHENTICATED'|'BANK_REJECTED'|'REQUEST_REJECTED'|'OUTCOME_UNKNOWN';
  contractReference:string|null;providerCode:string|null;requestSubmitted:boolean|null;bankAuthenticationObserved:boolean;
  collectionAuthorised:false;financialReceipt:false;retryAllowed:false;
};
const result=(outcome:DebiCheckAuthenticationOutcome['outcome'],contractReference:string|null=null,providerCode:string|null=null):DebiCheckAuthenticationOutcome=>({outcome,contractReference,providerCode,requestSubmitted:providerCode==='000'?true:outcome==='REQUEST_REJECTED'?false:null,bankAuthenticationObserved:outcome==='BANK_AUTHENTICATED',collectionAuthorised:false,financialReceipt:false,retryAllowed:false});
export function parseDebiCheckAuthentication(xml:string):DebiCheckAuthenticationOutcome{
  try{
    const response=debiCheckSoapResult(xml,'DebiCheckAuthenticate');
    const allowed=new Set(['ErrorCode','BankResponseCode','BankservResponseCode','ClientResponseCode','ContractReference','Messages','Status']);
    if(response.children.some(child=>!allowed.has(child.name))||new Set(response.children.map(child=>child.name)).size!==response.children.length)return result('OUTCOME_UNKNOWN');
    const optional=(name:string)=>response.children.some(child=>child.name===name)?debiCheckScalar(response,name,true):null;
    const code=optional('ErrorCode'),safeCode=code&&/^\d{3}$/.test(code)?code:null;
    const rawReference=optional('ContractReference'),reference=rawReference&&/^NC\d{12}$/.test(rawReference)?rawReference:null;
    if(rawReference&&!reference)return result('OUTCOME_UNKNOWN',null,safeCode);
    // Retain a valid returned contract even if the bank result is incomplete;
    // it is needed for later read-only reconciliation, never a replay.
    if(code!=='000')return ['100','203','325'].includes(code??'')&&!reference?result('REQUEST_REJECTED',null,code):result('OUTCOME_UNKNOWN',reference,safeCode);
    const bank=optional('BankResponseCode'),bankserv=optional('BankservResponseCode'),client=optional('ClientResponseCode'),status=optional('Status');
    if(!reference)return result('OUTCOME_UNKNOWN',null,code);
    if(bank==='900000'&&bankserv==='ACCP'&&client==='TRUE'&&status==='Accepted')return result('BANK_AUTHENTICATED',reference,code);
    if(bank==='900000'&&bankserv==='ACCP'&&client==='FALSE'&&status==='Rejected')return result('BANK_REJECTED',reference,code);
    return result('OUTCOME_UNKNOWN',reference,code);
  }catch{return result('OUTCOME_UNKNOWN')}
}

/** Worker-only transport. The caller MUST persist its single-attempt claim first.
 * No route or automatic caller exposes this transport until the consent,
 * independent-review, merchant/template and approved test-payer guards exist. */
export async function submitDebiCheckAuthenticationOnce(key:string,terms:DebiCheckAuthenticationTerms,request:typeof fetch=fetch):Promise<DebiCheckAuthenticationOutcome>{
  // Invalid local terms fail before any network attempt; they are not bank outcomes.
  const body=buildDebiCheckAuthenticationEnvelope(key,terms);
  try{
    const response=await request(DEBICHECK_ENDPOINT,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(200000),headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/INIWS_NIF/DebiCheckAuthenticate"'},body});
    if(!response.ok)return result('OUTCOME_UNKNOWN');
    return parseDebiCheckAuthentication((await boundedBody(response,64000)).toString());
  }catch{return result('OUTCOME_UNKNOWN')}
}
