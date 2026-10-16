"use client";
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
const evidence=z.object({actorId:z.string(),at:z.iso.datetime(),reference:z.string()}).strict();
export const refundRequestProjectionSchema=z.object({id:z.string().regex(/^netcash-refund-attempt:[a-f\d]{64}$/),refundId:z.string().regex(/^netcash-refund:[a-f\d]{64}$/),facilityId:z.string(),revision:z.number().int().positive(),state:z.enum(['PREPARED','REVIEWED','REJECTED','WITHDRAWN','CLAIMED','RESULT_RETAINED']),cycle:z.number().int().min(1).max(11).default(1),created:evidence,review:evidence.nullable(),closed:evidence.nullable().default(null),history:z.array(z.object({cycle:z.number().int().positive(),state:z.enum(['REJECTED','WITHDRAWN']),created:evidence,review:evidence.nullable(),closed:evidence}).strict()).max(10).default([]),claimAt:z.iso.datetime().nullable(),claimReference:z.string().trim().min(3).max(200).nullable().default(null),claimRetained:z.boolean(),providerOutcome:z.enum(['NOT_CLAIMED','CLAIMED_NO_VERIFIED_RESULT','ACKNOWLEDGED_PENDING_MERCHANT','DUPLICATE_OWNERSHIP_UNKNOWN','REJECTED','UNKNOWN']),providerCode:z.enum(['000','100','200','202','316','330']).nullable(),responseComplete:z.boolean().nullable(),financialPosting:z.literal(false),retryAvailable:z.literal(false)}).strict().superRefine((value,context)=>{
 if(value.history.length!==value.cycle-1||['REJECTED','WITHDRAWN'].includes(value.state)!==!!value.closed)context.addIssue({code:'custom',message:'Preparation history mismatch'});
 if(value.claimRetained!==['CLAIMED','RESULT_RETAINED'].includes(value.state)||value.claimRetained!==!!value.claimAt||value.claimRetained!==!!value.claimReference)context.addIssue({code:'custom',message:'Claim state mismatch'});
 if(value.claimRetained&&value.providerOutcome==='NOT_CLAIMED'||!value.claimRetained&&value.providerOutcome!=='NOT_CLAIMED')context.addIssue({code:'custom',message:'Provider outcome mismatch'});
});
const responseSchema=refundRequestProjectionSchema.safeExtend({resultRetained:z.boolean().optional(),lastGuardPassed:z.boolean().optional()});
type Attempt=z.infer<typeof refundRequestProjectionSchema>;
type Row={id:string;facilityId:string;revision:number;state:string;attempt?:Attempt|null};
type Action='prepare-send'|'review-send'|'send'|'reject-send'|'withdraw-send'|'renew-send';
const words:Record<Action,string>={'prepare-send':'PREPARE REFUND REQUEST','review-send':'APPROVE REFUND REQUEST',send:'REQUEST NETCASH REFUND','reject-send':'REJECT UNCLAIMED REQUEST','withdraw-send':'WITHDRAW UNCLAIMED REQUEST','renew-send':'PREPARE FRESH REFUND REQUEST'};
const labels:Record<Action,string>={'prepare-send':'Prepare provider request','review-send':'Review provider request',send:'Request refund from Netcash','reject-send':'Reject unclaimed preparation','withdraw-send':'Withdraw unclaimed preparation','renew-send':'Prepare fresh provider request'};
const outcomes:Record<Attempt['providerOutcome'],string>={NOT_CLAIMED:'No provider request has been claimed in Stor24.',CLAIMED_NO_VERIFIED_RESULT:'A request has been claimed. No verified provider result is retained. Keep the refund held for review.',ACKNOWLEDGED_PENDING_MERCHANT:'Netcash acknowledged the refund request. Merchant authorization and payout confirmation remain outstanding.',DUPLICATE_OWNERSHIP_UNKNOWN:'Netcash reports an existing refund request. Ownership is unknown. Keep the refund held; do not resend.',REJECTED:'The provider response reports rejection. The original claim remains held for review; do not resend.',UNKNOWN:'The provider outcome is unknown. Keep the refund held; do not resend.'};
export function NetcashRefundRequestActions({row,userId,enabled,canSend,canReview,disabled,onPending,onRefresh}:{row:Row;userId:string;enabled:boolean;canSend:boolean;canReview:boolean;disabled:boolean;onPending:(value:boolean)=>void;onRefresh:()=>Promise<void>}){
 const[action,setAction]=useState<Action|null>(null),[reference,setReference]=useState(''),[confirmation,setConfirmation]=useState(''),[checked,setChecked]=useState(false),[pending,setPending]=useState(false),[feedback,setFeedback]=useState('');
 const[selection,setSelection]=useState<{reservationRevision:number;attemptRevision:number|null}|null>(null);
 const lock=useRef(false),abort=useRef<AbortController|null>(null),notice=useRef<HTMLParagraphElement>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 const attempt=row.attempt;
 const choiceChanged=!!action&&(!selection||selection.reservationRevision!==row.revision||selection.attemptRevision!==(attempt?.revision??null));
 const available:Action[]=[];
 if(!disabled&&attempt&&!attempt.claimRetained&&['PREPARED','REVIEWED'].includes(attempt.state)){if(canSend&&attempt.created.actorId===userId)available.push('withdraw-send');if(canReview&&attempt.created.actorId!==userId)available.push('reject-send');}
 if(enabled&&!disabled&&row.state==='RESERVED'&&!attempt?.claimRetained){
  if(!attempt&&canSend)available.push('prepare-send');
  if(attempt&&['REJECTED','WITHDRAWN'].includes(attempt.state)&&canSend)available.push('renew-send');
  if(attempt?.state==='PREPARED'&&canReview&&attempt.created.actorId!==userId)available.push('review-send');
  if(attempt?.state==='REVIEWED'&&canSend&&attempt.created.actorId===userId)available.push('send');
 }
 async function submit(){
  if(!action||!selection||choiceChanged||!available.includes(action)||!checked||confirmation!==words[action]||reference.trim().length<3||lock.current)return;
  lock.current=true;abort.current=new AbortController();setPending(true);onPending(true);setFeedback('');let refresh=false;
  try{
   const response=await fetch('/api/v1/adjustments/netcash-refunds/requests',{method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.any([abort.current.signal,AbortSignal.timeout(100000)]),headers:{'content-type':'application/json'},body:JSON.stringify({action,facilityId:row.facilityId,refundId:row.id,reservationRevision:selection.reservationRevision,...(action==='prepare-send'?{}:{attemptRevision:selection.attemptRevision}),reference,confirmation,confirmed:true})});
   const payload=await response.json();if(!response.ok)throw Error(typeof payload?.error?.message==='string'?payload.error.message.slice(0,500):'The request needs review. Refresh retained history; do not resubmit a claimed refund.');
   const parsed=responseSchema.safeParse(payload.data);
   if(!parsed.success||parsed.data.refundId!==row.id||parsed.data.facilityId!==row.facilityId)throw Error('The response could not be verified. Refresh retained history; do not resend.');
   setFeedback(action==='send'?outcomes[parsed.data.providerOutcome]:'Saved. Refreshing the independent request review history.');setAction(null);setReference('');setConfirmation('');setChecked(false);refresh=true;
  }catch(error){setAction(null);setFeedback(error instanceof Error&&error.name!=='AbortError'?error.message:'The result is unverified. Refresh retained history before continuing; do not resend.');setTimeout(()=>notice.current?.focus(),0);refresh=true;}
  finally{lock.current=false;setPending(false);onPending(false);}
  if(refresh)await onRefresh();
 }
 return<section className="page-stack" aria-label="Provider refund request">
  {attempt&&<><h4>Provider request — {attempt.state.replaceAll('_',' ').toLowerCase()}</h4><p>{outcomes[attempt.providerOutcome]} This is not a completed payout or financial posting.</p><p>Requested {new Date(attempt.created.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} SAST. {attempt.review&&`Independent SEND review ${new Date(attempt.review.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} SAST.`}</p></>}
  {attempt?.claimReference&&<p>Request reference: {attempt.claimReference}.</p>}
  {attempt?.closed&&<p>Preparation {attempt.state.toLowerCase()} before any provider claim, {new Date(attempt.closed.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} SAST. Reference: {attempt.closed.reference}. The financial hold is managed separately.</p>}
  {!!attempt?.history.length&&<details><summary>Earlier unclaimed preparations ({attempt.history.length})</summary><ul>{attempt.history.map(item=><li key={item.cycle}>Preparation {item.cycle}: {item.state.toLowerCase()}, {new Date(item.closed.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} SAST. Reference: {item.closed.reference}. {item.review?'Earlier independent SEND review retained.':'No SEND approval was recorded.'}</li>)}</ul></details>}
  {!enabled&&row.state==='RESERVED'&&!attempt?.claimRetained&&<p>Provider requests are disabled. Retained request and hold history remains available.</p>}
  {available.map(value=><button key={value} className="button button-secondary" type="button" disabled={pending||disabled} onClick={()=>{setAction(value);setSelection({reservationRevision:row.revision,attemptRevision:attempt?.revision??null});setReference('');setConfirmation('');setChecked(false);setFeedback('');}}>{labels[value]}</button>)}
  {action&&<form className="page-stack" aria-label="Confirm provider refund request" onSubmit={event=>{event.preventDefault();void submit();}}><h4>{labels[action]}</h4>{choiceChanged&&<p role="alert">Retained history changed. Cancel and choose the action again before confirming.</p>}<p>{action==='send'?'This requests a real refund against the original card transaction. The claim cannot be retried. Merchant authorization and payout confirmation remain separate.':action==='reject-send'||action==='withdraw-send'?'This closes an unclaimed preparation only. It does not release the financial hold or authorize any payment.':action==='renew-send'?'This starts a fresh preparation and independent SEND review while preserving the earlier closed preparation. Claimed provider requests can never be renewed.':'This is a separate SEND review. The earlier preparation approval does not authorize a provider request.'}</p><label>Provider request reference<input aria-label="Provider request reference" value={reference} maxLength={200} minLength={3} required disabled={pending||disabled} onChange={event=>setReference(event.target.value)}/></label><label>Type {words[action]}<input aria-label="Provider request confirmation" value={confirmation} autoComplete="off" disabled={pending||disabled} onChange={event=>setConfirmation(event.target.value)}/></label><label><input type="checkbox" checked={checked} disabled={pending||disabled} onChange={event=>setChecked(event.target.checked)}/>I have checked the original refund and this separate request.</label><button className="button" disabled={pending||disabled||choiceChanged||!available.includes(action)||!checked||confirmation!==words[action]||reference.trim().length<3}>Confirm {labels[action].toLowerCase()}</button><button className="button button-secondary" type="button" disabled={pending||disabled} onClick={()=>setAction(null)}>Cancel provider action</button></form>}
  {feedback&&<p role="status" tabIndex={-1} ref={notice}>{feedback}</p>}
 </section>;
}
