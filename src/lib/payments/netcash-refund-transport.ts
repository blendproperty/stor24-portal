import {PAYNOW_SOAP_ENDPOINT,payNowSoapEnvelope} from './netcash-paynow-soap';
import {payNowSoapResult} from './netcash-paynow-response';
import {refundTransactionId} from './netcash-refund-policy';
import type {RefundSendApproval} from './netcash-refund-send-policy';

export type RefundResponseCapture={httpStatus:number|null;bodyBase64:string;complete:boolean;capturedBytes:number;outcome:'ACKNOWLEDGED_PENDING_MERCHANT'|'DUPLICATE_OWNERSHIP_UNKNOWN'|'REJECTED'|'UNKNOWN';providerCode:string|null;financialPosting:false;retryAvailable:false};
/** ONE physical fetch. Caller must already have committed an irreversible
 * account-locked claim and rechecked current review/source/credential/approval.
 * No request body, service key, raw headers or exception text is retained. */
export function assertRefundTransportInput(serviceKey:string,input:{transactionId:string;amount:string;wireFormat:RefundSendApproval['wireFormat']}){
 if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(serviceKey)||! /^(?:0|[1-9]\d{0,5})\.\d{2}$/.test(input.amount)||Number(input.amount)<=0||!['DECIMAL_DOT','DECIMAL_COMMA'].includes(input.wireFormat))throw Error('NETCASH_REFUND_TRANSPORT_INPUT');
 refundTransactionId(input.transactionId);
}
export async function transportRefundRequest(serviceKey:string,input:{transactionId:string;amount:string;wireFormat:RefundSendApproval['wireFormat']},request:typeof fetch=fetch):Promise<RefundResponseCapture>{
 assertRefundTransportInput(serviceKey,input);
 const chunks:Buffer[]=[];let capturedBytes=0,httpStatus:number|null=null,complete=false;
 try{
  const response=await request(PAYNOW_SOAP_ENDPOINT,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/IPayNow/RequestCreditCardRefund"'},body:payNowSoapEnvelope('RequestCreditCardRefund',[['M1',serviceKey],['TransactionId',input.transactionId],['amount',input.wireFormat==='DECIMAL_COMMA'?input.amount.replace('.',','):input.amount]])});
  httpStatus=response.status;
  if(response.body){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done){complete=true;break;}const remaining=64000-capturedBytes;chunks.push(Buffer.from(part.value.subarray(0,remaining)));capturedBytes+=Math.min(part.value.length,remaining);if(part.value.length>remaining){void reader.cancel().catch(()=>{});break;}}}finally{reader.releaseLock();}}
  else complete=true;
 }catch{/* Timeout/network/stream failure remains an irreversible unknown. */}
 const bytes=Buffer.concat(chunks),result:RefundResponseCapture={httpStatus,bodyBase64:bytes.toString('base64'),complete,capturedBytes,outcome:'UNKNOWN',providerCode:null,financialPosting:false,retryAvailable:false};
 // Never accept a seemingly successful prefix of incomplete XML, a fault, an
 // unexpected result string or a non-success HTTP status. Original response
 // bytes (possibly explicitly incomplete) are for encrypted journal storage.
 if(complete&&httpStatus!==null&&httpStatus>=200&&httpStatus<300){try{
  const code=payNowSoapResult(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'RequestCreditCardRefund');
  if(['000','100','200','202','316','330'].includes(code))result.providerCode=code;
  if(code==='000')result.outcome='ACKNOWLEDGED_PENDING_MERCHANT';
  else if(code==='330')result.outcome='DUPLICATE_OWNERSHIP_UNKNOWN';
  else if(['100','202','316'].includes(code))result.outcome='REJECTED';
 }catch{/* Malformed, invalid UTF-8, ambiguous or unknown result remains held. */}}
 return result;
}
