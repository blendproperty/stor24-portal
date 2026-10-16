"use client";
import {useEffect,useState} from 'react';
import {TenantDebiCheckBankConsents} from './tenant-debicheck-bank-consents';

type Row={id:string;accountId:string;status:string;monthlyAmount:string;startDate:string;bankSuffix:string;consentText:string;authenticationSubmitted:false;collectionEnabled:false;financialReceipt:false};
const blank={debtorIdentification:'',debtorIdentificationCode:'I',accountName:'',bankAccountName:'',branchCode:'',bankAccountNumber:'',bankAccountType:'Current',mobileNumber:'',emailAddress:''};
function row(value:unknown,accountId:string):Row{
 const v=value as Row;
 if(!v||v.accountId!==accountId||!/^debicheck-request:[a-f\d-]{36}$/.test(v.id)||!['PREVIEW','REQUESTED','REVIEWED','WITHDRAWN'].includes(v.status)||!/^\d{1,6}\.\d{2}$/.test(v.monthlyAmount)||!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)||!/^\d{1,4}$/.test(v.bankSuffix)||typeof v.consentText!=='string'||!v.consentText||v.authenticationSubmitted!==false||v.collectionEnabled!==false||v.financialReceipt!==false)throw Error('Setup status needs a fresh valid response.');
 return v;
}
type Snapshot={available:boolean;templateObservationId:string|null;requests:Row[]};
export function TenantDebiCheckRequests({accountId}:{accountId:string}){
 const[snapshot,setSnapshot]=useState<Snapshot|null>(null),[payer,setPayer]=useState(blank),[startDate,setStartDate]=useState(''),[preview,setPreview]=useState<{display:Row;ticket:Record<string,unknown>}|null>(null),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function read(){
  const response=await fetch('/api/tenant/debicheck-requests?accountId='+encodeURIComponent(accountId),{cache:'no-store',signal:AbortSignal.timeout(20000)}),value=await response.json(),v=value?.data;
  if(!response.ok)throw Error(value.error??'Setup status is unavailable.');
  if(!v||typeof v.available!=='boolean'||!(v.templateObservationId===null||typeof v.templateObservationId==='string')||!Array.isArray(v.requests))throw Error('Setup status needs a fresh valid response.');
  return{available:v.available,templateObservationId:v.templateObservationId,requests:v.requests.map((r:unknown)=>row(r,accountId))} as Snapshot;
 }
 useEffect(()=>{let active=true;read().then(value=>{if(active)setSnapshot(value)}).catch(()=>{if(active)setError('DebiCheck request status is temporarily unavailable.')});return()=>{active=false}},[accountId]); // eslint-disable-line react-hooks/exhaustive-deps
 async function post(body:object){const response=await fetch('/api/tenant/debicheck-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)}),value=await response.json();if(!response.ok)throw Error(value.error??'Ask staff to review this request.');return value.data;}
 async function act(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work()}catch(e){setPreview(null);setAccepted(false);setSnapshot(null);setPayer(blank);setError(e instanceof Error?e.message:'Refresh before continuing.')}finally{setBusy(false)}}
 function field(key:keyof typeof blank,value:string){setPayer({...payer,[key]:value});setPreview(null);setAccepted(false);}
 if(!snapshot&&!error)return null;
 if(snapshot&&!snapshot.available&&!snapshot.requests.length)return null;
 const pending=snapshot?.requests.some(r=>r.status!=='WITHDRAWN');
 return<section className="tenant-card-subscriptions" aria-label="DebiCheck setup requests">
  <h3>DebiCheck setup requests</h3><p>Prepare a request on the Netcash test account. Staff review, a provider mandate and bank authentication are separate steps. This screen does not submit a bank request or collect money.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" disabled={busy} onClick={()=>void act(async()=>{setPreview(null);setAccepted(false);setSnapshot(await read())})}>Refresh DebiCheck requests</button>
  {snapshot?.available&&!pending&&!preview&&(!snapshot.templateObservationId?<p>A current independently reviewed test template is needed. Ask staff to review it first.</p>:<form autoComplete="off" onSubmit={event=>{event.preventDefault();void act(async()=>{const value=await post({action:'preview',accountId,templateObservationId:snapshot.templateObservationId,startDate,payer}),display=row(value,accountId);if(!value.preview||typeof value.preview!=='object'||value.preview.recordId!==display.id||value.preview.accountId!==accountId)throw Error('The preview needs a fresh response.');setPreview({display,ticket:value.preview});setPayer(blank);setAccepted(false);})}}>
   <p>Use the email address verified for this tenant account. Enter details only for a bank account you are entitled to provide.</p>
   <div className="tenant-card-fields">
    <label>First monthly date<input type="date" required value={startDate} disabled={busy} onChange={e=>{setStartDate(e.target.value);setPreview(null);setAccepted(false)}}/></label>
    <label>Identification type<select aria-label="Identification type" value={payer.debtorIdentificationCode} disabled={busy} onChange={e=>field('debtorIdentificationCode',e.target.value)}><option value="I">South African ID</option><option value="P">Passport</option><option value="C">Company registration</option></select></label>
    {([['debtorIdentification','ID, passport or registration','text'],['accountName','Tenant account name','text'],['bankAccountName','Bank account holder','text'],['branchCode','Six-digit branch code','text'],['bankAccountNumber','Bank account number','text'],['mobileNumber','Mobile number','tel'],['emailAddress','Verified tenant email','email']] as const).map(([key,label,type])=><label key={key}>{label}<input type={type} required maxLength={key==='bankAccountNumber'?20:key==='branchCode'?6:key==='mobileNumber'?10:100} value={payer[key]} disabled={busy} onChange={e=>field(key,e.target.value)}/></label>)}
    <label>Bank account type<select aria-label="Bank account type" value={payer.bankAccountType} disabled={busy} onChange={e=>field('bankAccountType',e.target.value)}><option value="Current">Current</option><option value="Savings">Savings</option><option value="Transmission">Transmission</option></select></label>
   </div><p>Use the first day of a future month. The amount comes from the approved monthly billing plan.</p><button type="submit" disabled={busy}>Review DebiCheck request</button>
  </form>)}
  {preview&&<div><p>{preview.display.consentText}</p><p>Bank account ending {preview.display.bankSuffix}.</p><label><input type="checkbox" disabled={busy} checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I confirm this setup request and permission to provide these details.</label><button type="button" disabled={busy||!accepted} onClick={()=>void act(async()=>{const result=row(await post({action:'save',accountId,preview:preview.ticket,accepted:true}),accountId);if(result.id!==preview.display.id||result.status!=='REQUESTED')throw Error('Refresh the saved request before continuing.');setPreview(null);setAccepted(false);setSnapshot(await read());setNotice('Request saved for staff review. No bank request or collection was submitted.');})}>Save for staff review</button><button type="button" disabled={busy} onClick={()=>{setPreview(null);setAccepted(false);setPayer(blank)}}>Discard preview</button></div>}
  {snapshot?.requests.map(r=><article key={r.id}><h4>{r.status==='REQUESTED'?'Awaiting staff review':r.status==='REVIEWED'?'Staff reviewed — bank setup still pending':'Request withdrawn'}</h4><p>R{r.monthlyAmount} monthly from {r.startDate}; bank account ending {r.bankSuffix}.</p>{r.status!=='WITHDRAWN'&&<button type="button" disabled={busy} onClick={()=>void act(async()=>{const result=row(await post({action:'withdraw',accountId,id:r.id}),accountId);if(result.id!==r.id||result.status!=='WITHDRAWN')throw Error('Refresh the saved request.');setSnapshot(await read());setNotice('Pending setup request withdrawn.');})}>Withdraw setup request</button>}</article>)}
 <TenantDebiCheckBankConsents key={accountId} accountId={accountId} requestId={snapshot?.requests.find(r=>r.status==='REVIEWED')?.id??''}/>
 </section>;
}
