export function redactHistoryMessage(text:string) {
  let value=text.replace(/https?:\/\/[^\s<>"]+/gi,"[link omitted]").replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,"[credential omitted]").replace(/\b(?:verification|one.time|security|login|OTP)\s*(?:code)?\s*[:=]?\s*\d{4,8}\b/gi,"[verification code omitted]");
  for(const key of ["AUTH_SECRET","TWILIO_AUTH_TOKEN","RESEND_API_KEY","SENDGRID_API_KEY","PUBLIC_BOOKING_API_KEY","INTEGRATION_CONFIG_ENCRYPTION_KEY"]){const secret=process.env[key];if(secret&&secret.length>=16)value=value.replaceAll(secret,"[credential omitted]");}
  return value;
}
export function historyEvidence(payload:unknown) {
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
  const value=payload as Record<string,unknown>;
  const body=typeof value.text==="string"?value.text:typeof value.body==="string"?value.body:null;
  if(!body||body.length>32000)return null;
  return {version:1,text:redactHistoryMessage(body),subject:typeof value.subject==="string"?redactHistoryMessage(value.subject).slice(0,500):"",redacted:true};
}
export function archivedHistoryText(metadata:unknown) {
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return null;
  const evidence=(metadata as Record<string,unknown>).historyEvidence;
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))return null;
  const value=evidence as Record<string,unknown>;
  return value.version===1&&typeof value.text==="string"&&value.text.length<=32000?redactHistoryMessage(value.text):null;
}
