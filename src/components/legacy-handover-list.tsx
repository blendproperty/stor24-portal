"use client";
import "@/styles/legacy-handover.css";
import { useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { confirmLegacyHandoverAction } from "@/app/actions/leasing";

type Item={id:string;accountId:string;label:string;ready:boolean;handedOver:boolean;blockers:string[];payment:{requiredAmount:number;paidAmount:number};documentId:string|null;possibleLeads?:{id:string;label:string}[];photoPolicy?:{hash:string;notice:string;consentLabel:string;alternativeContact:string;trial:boolean}|null;trialPhoto:boolean;photo:{id:string;version:number;status:string}|null;canReviewPhoto:boolean};
const photoEndpoint=(trial:boolean)=>trial?"/api/v1/access/legacy-trial-photo":"/api/v1/access/legacy-photo";
export function LegacyHandoverList({items}:{items:Item[]}) {
  const [preview,setPreview]=useState<string|null>(null),[previewLoaded,setPreviewLoaded]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [handoff,setHandoff]=useState<{tenancyId:string;url:string;qr:string;expiresAt:string}|null>(null);
  async function preparePhoto(item:Item) {
    setBusy(true);setError("");setHandoff(null);
    try {
      const response=await fetch("/api/v1/access/legacy-photo/handoff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenancyId:item.id,version:item.photo?.version??0,identityConfirmed:true})});
      const body=await response.json();if(!response.ok)throw Error(body.error);
      const url=`https://stor24.co.za/walk-in/photo#capture=${body.data.token}`;
      setHandoff({tenancyId:item.id,url,qr:await QRCode.toDataURL(url,{margin:2,width:240}),expiresAt:body.data.expiresAt});
    } catch(error) {setError(error instanceof Error?error.message:"Could not prepare the customer tablet.");}
    finally{setBusy(false);}
  }
  async function review(photo:NonNullable<Item["photo"]>,decision:"APPROVE"|"REJECT",trial:boolean) {
    setBusy(true);setError("");try{const query=new URLSearchParams({id:photo.id,version:String(photo.version),decision});const response=await fetch(`${photoEndpoint(trial)}?${query}`,{method:"POST"});const body=await response.json();if(!response.ok)throw Error(body.error);window.location.reload();}catch(error){setError(error instanceof Error?error.message:"Review unavailable");}finally{setBusy(false);}
  }
  if(!items.length)return null;
  return <section id="legacy-handovers" className="page-stack"><h2>Signed lease handovers and photo reviews</h2><p>Open the original lease and reconcile the checks before handing over keys. Existing history is retained.</p>{error&&<p role="alert" className="form-error">{error}</p>}{items.map(item=><article className="handover-check" key={item.id}>
    <h3>{item.label}</h3><p>Verified payment: R {item.payment.paidAmount.toFixed(2)} of R {item.payment.requiredAmount.toFixed(2)} recorded initial charge.</p>
    {item.photoPolicy?.trial&&<p>Unit 58 photo-only trial: payment is not needed to test photo capture. This does not confirm move-in, hand over keys or activate door access.</p>}
    {item.documentId&&<a href={`/api/v1/documents/${encodeURIComponent(item.documentId)}/signed`} target="_blank" rel="noopener noreferrer">View signed agreement</a>}
    <p>Photo: {item.photo?.status.replaceAll("_"," ")??"not submitted"}. Access activation is separate.</p>
    {item.photo?.status==="WAITING_REVIEW"&&<p className="legacy-photo-confirmation" role="status">Photo saved for private staff review. Tap “Open photo for review” below to check it.</p>}
    {item.canReviewPhoto&&item.photoPolicy&&(!item.photo||["EXPIRED","REJECTED","WITHDRAWN"].includes(item.photo.status))&&<section className="legacy-photo-handoff"><h4>Customer photo on the Counter tablet</h4><p>Check the original ID here. The customer then sees only the photo notice, consent and camera screen in the separate STOR24 Counter app.</p><form onSubmit={event=>{event.preventDefault();void preparePhoto(item);}}><label><input type="checkbox" required disabled={busy}/> I checked this customer’s original identity document in person.</label><button className="button button-primary" disabled={busy}>{busy?"Preparing…":"Prepare customer photo screen"}</button></form>{handoff?.tenancyId===item.id&&<div className="legacy-photo-handoff-ready"><p>On the unsigned Counter tablet, scan this QR. It works once and expires at {new Date(handoff.expiresAt).toLocaleTimeString("en-ZA",{timeZone:"Africa/Johannesburg",hour:"2-digit",minute:"2-digit"})}. Keep the staff portal on your own screen.</p><Image src={handoff.qr} alt="Scan to open the customer-only photo screen" width={240} height={240} unoptimized/><p>When the customer sees that the photo was saved, take the tablet back and check its status here.</p><button type="button" className="button button-secondary" onClick={()=>window.location.reload()}>Check saved photo</button></div>}</section>}
    {item.canReviewPhoto&&item.photo&&["WAITING_REVIEW","APPROVED","PENDING_PROVIDER"].includes(item.photo.status)&&<details><summary>Customer asks to withdraw photo consent</summary><p>Confirm the customer against their original ID. This removes the stored photograph; provider or device deletion remains a separate staff task.</p><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError("");try{const response=await fetch(`${photoEndpoint(item.trialPhoto)}?action=assisted-withdraw`,{method:"POST",body:new FormData(event.currentTarget)});const body=await response.json();if(!response.ok)throw Error(body.error);window.location.reload();}catch(error){setError(error instanceof Error?error.message:"Withdrawal unavailable");}finally{setBusy(false);}}}>
      <input type="hidden" name="tenancyId" value={item.id}/><input type="hidden" name="version" value={item.photo.version}/><label><input type="checkbox" name="identityChecked" required disabled={busy}/> I checked the customer’s original identity document and they requested withdrawal.</label><button className="button button-secondary" disabled={busy}>Withdraw consent and remove photo</button>
    </form></details>}
    {item.canReviewPhoto&&item.photo?.status==="WAITING_REVIEW"&&<div><button type="button" onClick={()=>{setPreviewLoaded(false);setPreview(item.photo!.id);}}>Open photo for review</button>{preview===item.photo.id&&<div>{/* Private DLP-protected image must bypass the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${photoEndpoint(item.trialPhoto)}?${new URLSearchParams({id:item.photo.id,version:String(item.photo.version)})}`} alt="Customer access photo for staff review" width={240} onLoad={()=>setPreviewLoaded(true)} onError={()=>{setPreviewLoaded(false);setError("The private preview could not be opened.");}} /><p>Check that the photo clearly shows the customer.</p><button type="button" disabled={busy||!previewLoaded} onClick={()=>void review(item.photo!,"APPROVE",item.trialPhoto)}>Approve photo</button><button type="button" disabled={busy||!previewLoaded} onClick={()=>void review(item.photo!,"REJECT",item.trialPhoto)}>Request another photo</button></div>}</div>}
    {!!item.blockers.length&&<ul>{item.blockers.map(message=><li key={message}>{message}</li>)}</ul>}
    {item.handedOver?<p>Key handover recorded.</p>:<form action={async form=>{setBusy(true);setError("");try{const result=await confirmLegacyHandoverAction(form);if(result?.error)setError(result.error);}finally{setBusy(false);}}}>
      <input type="hidden" name="tenancyId" value={item.id}/>{!!item.possibleLeads?.length&&<label>Link the original enquiry only if confirmed<select name="leadId" defaultValue=""><option value="">No confirmed enquiry link</option>{item.possibleLeads.map(lead=><option key={lead.id} value={lead.id}>{lead.label}</option>)}</select></label>}<label><input type="checkbox" name="handoverConfirmed" required disabled={!item.ready||busy}/> I matched the customer to their original identity document, checked the unit and am handing over its keys.</label><button className="button button-primary" disabled={!item.ready||busy}>Confirm move-in and key handover</button>
    </form>}
  </article>)}</section>;
}
