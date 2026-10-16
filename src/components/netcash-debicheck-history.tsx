"use client";
import {useEffect,useRef,useState} from 'react';
import {debiCheckHistorySnapshot,type DebiCheckHistorySnapshot} from '@/lib/payments/netcash-debicheck-history-policy';

const labels={CLAIMED:'Attempt claimed — outcome not recorded',BANK_AUTHENTICATED:'Bank authentication observed',BANK_REJECTED:'Bank authentication rejected',REQUEST_REJECTED:'Request rejected',OUTCOME_UNKNOWN:'Outcome unknown — investigate'};
const stamp=(value:string)=>new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Johannesburg'}).format(new Date(value))+' SAST';
async function read(facilityId:string,status:string,extra:Record<string,string>={},signal?:AbortSignal){
 const params=new URLSearchParams({facilityId,...(status?{status}:{}),...extra}),response=await fetch('/api/v1/payments/netcash/debicheck/history?'+params,{cache:'no-store',signal:signal??AbortSignal.timeout(20000)}),body=await response.json();
 if(!response.ok)throw Error(body.error?.message??'Retained authentication history is unavailable.');
 const snapshot=debiCheckHistorySnapshot.parse(body.data);
 if(snapshot.facilityId!==facilityId||snapshot.attempts.some(row=>status&&row.status!==status)||extra.attemptId&&snapshot.selected?.id!==extra.attemptId)throw Error('Refresh the selected store and retained history.');
 return snapshot;
}
export function NetcashDebiCheckHistory({facilities}:{facilities:{id:string;name:string}[]}){
 const[facilityId,setFacilityId]=useState(facilities[0]?.id??''),[status,setStatus]=useState(''),[snapshot,setSnapshot]=useState<DebiCheckHistorySnapshot|null>(null),[busy,setBusy]=useState(!!facilities.length),[error,setError]=useState('');
 const detail=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(snapshot?.selected)detail.current?.focus()},[snapshot]);
 useEffect(()=>{
  if(!facilityId)return;
  let active=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  read(facilityId,status,{},controller.signal).then(value=>{if(active)setSnapshot(value)}).catch(()=>{if(active){setSnapshot(null);setError('Retained authentication history is unavailable. Refresh before relying on an earlier result.')}}).finally(()=>{clearTimeout(timer);if(active)setBusy(false)});
  return()=>{active=false;controller.abort();clearTimeout(timer)};
 },[facilityId,status]);
 async function load(extra:Record<string,string>={}){
  setBusy(true);setError('');setSnapshot(null);
  try{setSnapshot(await read(facilityId,status,extra))}catch{setSnapshot(null);setError('Retained authentication history is unavailable or changed. Refresh before relying on an earlier result.')}finally{setBusy(false)}
 }
 function change(update:()=>void){setSnapshot(null);setError('');setBusy(true);update()}
 const selected=snapshot?.selected;
 return<section className="panel netcash-debicheck-history" aria-label="Recorded DebiCheck authentication">
  <h2>Recorded DebiCheck authentication</h2>
  <p>Read the original attempt separately from later retained status reads. Refresh reads Stor24’s saved evidence. Bank authentication does not confirm collected rent or a financial receipt.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:16,alignItems:'end'}}>
   <label>History store<select aria-label="DebiCheck history store" disabled={busy} value={facilityId} onChange={event=>change(()=>setFacilityId(event.target.value))}>{facilities.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
   <label>Original outcome<select aria-label="Original authentication outcome" disabled={busy} value={status} onChange={event=>change(()=>setStatus(event.target.value))}><option value="">All recorded outcomes</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <button type="button" className="button button-secondary" disabled={busy||!facilityId} onClick={()=>void load()}>Refresh recorded history</button>
  </div>
  {busy&&<p role="status">Reading retained history…</p>}{error&&<p role="alert">{error}</p>}
  {snapshot&&!snapshot.attempts.length&&<p>No retained authentication attempts match this store and outcome. This does not confirm a bank request was sent.</p>}
  {snapshot?.attempts.map(row=><article key={row.id} style={{overflowWrap:'anywhere',borderTop:'1px solid #dbe5e7',paddingBlock:16}}>
   <h3>{row.accountNumber} — {labels[row.status]}</h3><p>R{row.monthlyAmount} monthly from {row.startDate}; bank account ending {row.bankSuffix}.</p>
   <p>Attempt recorded {stamp(row.claimedAt)}. {row.completedAt?'Original outcome recorded '+stamp(row.completedAt)+'.':'No original outcome has been recorded.'}</p>
   <p>{row.originalContractAvailable?'An original provider contract reference is retained privately.':'No original provider contract reference is available.'} {row.reconciliationRequired?'Investigation is required; repeating the original request is blocked.':''}</p>
   <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load({attemptId:row.id})}>Inspect retained status reads for {row.accountNumber}</button>
  </article>)}
  {snapshot?.nextCursor&&<button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load({cursor:snapshot.nextCursor!})}>Older authentication attempts</button>}
  {selected&&snapshot&&<aside aria-label="Selected authentication evidence" style={{overflowWrap:'anywhere',borderTop:'2px solid #f05a00',paddingTop:16}}>
   <h3 ref={detail} tabIndex={-1}>Retained status reads — {selected.accountNumber}</h3><p>Original attempt: {labels[selected.status]}. Later reads do not replace that original outcome or authorise another attempt, collection or receipt.</p>
   {!snapshot.observations.length&&<p>No retained status reads for this attempt.</p>}
   {snapshot.observations.map(row=><p key={row.id}>{stamp(row.observedAt)} — {row.bankAuthenticationObserved?'Bank authentication was observed in this retained read.':'Bank authentication was not established in this retained read.'}</p>)}
   {snapshot.nextObservationCursor&&<button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load({attemptId:selected.id,observationCursor:snapshot.nextObservationCursor!})}>Older retained status reads</button>}
  </aside>}
 </section>;
}
