import { privacyHash } from "@/lib/request-security";
import { normalizeTwilioRecipient } from "@/lib/integrations/twilio-provider";
import { redactHistoryMessage } from "@/lib/customer-history-message-policy";

type RecordProof={provider:string|null;providerRef:string|null;channel:string;direction:string;messageType:string|null;recipientHash:string;metadata?:unknown};
export async function readHistoryMessage(proof:RecordProof,customerPhone:string|null,request:typeof fetch=fetch) {
  if(/VERIFICATION|OTP|PASSWORD|LOGIN|AUTHENTICATION/i.test(proof.messageType??""))return {body:"",source:"Authentication content excluded"};
  const metadata=proof.metadata&&typeof proof.metadata==="object"&&!Array.isArray(proof.metadata)?proof.metadata as Record<string,unknown>:null;
  const archived=metadata?.historyEvidence;
  if(archived&&typeof archived==="object"&&!Array.isArray(archived)){
    const evidence=archived as Record<string,unknown>;
    if(evidence.version===1&&typeof evidence.text==="string"&&evidence.text.length<=32000)return {body:redactHistoryMessage(evidence.text),subject:typeof evidence.subject==="string"?redactHistoryMessage(evidence.subject):"",source:"Retained message text; links and access codes omitted"};
  }
  if(proof.provider!=="twilio"||!/^SM[a-f0-9]{32}$/i.test(proof.providerRef??""))return {body:"",source:"Original message text not retained in this historical log"};
  const account=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  if(!/^AC[a-f0-9]{32}$/i.test(account??"")||!token)return {body:"",source:"Provider message content unavailable"};
  try{
    const response=await request(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${proof.providerRef}.json`,{method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(5000),headers:{authorization:"Basic "+Buffer.from(account+":"+token).toString("base64")}});
    if(!response.ok)return {body:"",source:"Provider message content unavailable"};
    const value=await response.json();
    const recipient=proof.direction==="INBOUND"?value.from:value.to;
    if(value.sid!==proof.providerRef||value.account_sid!==account||typeof recipient!=="string"||typeof value.direction!=="string"||!(proof.direction==="INBOUND"?value.direction==="inbound":value.direction.startsWith("outbound")))return {body:"",source:"Provider record could not be matched"};
    if((proof.channel==="WHATSAPP")!==recipient.startsWith("whatsapp:"))return {body:"",source:"Provider record could not be matched"};
    const phone=recipient.replace(/^whatsapp:/,""),normalized=normalizeTwilioRecipient(phone);
    const candidates=[phone,normalized,...(normalized?.startsWith("+27")?[normalized.slice(1),"0"+normalized.slice(3)]:[])].filter((v):v is string=>!!v);
    if(customerPhone&&normalizeTwilioRecipient(customerPhone)===normalized)candidates.push(customerPhone);
    if(!candidates.some(p=>privacyHash(p)===proof.recipientHash))return {body:"",source:"Provider recipient could not be matched"};
    if(typeof value.body!=="string"||!value.body.trim()||value.body.length>32000)return {body:"",source:"Provider message text unavailable or redacted"};
    return {body:redactHistoryMessage(value.body),source:"Original provider message text; links and access codes omitted"};
  }catch{return {body:"",source:"Provider message content unavailable"};}
}
