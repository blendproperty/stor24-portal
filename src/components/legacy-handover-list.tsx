"use client";
import { useState } from "react";
import { confirmLegacyHandoverAction } from "@/app/actions/leasing";

type Item={id:string;accountId:string;label:string;ready:boolean;handedOver:boolean;blockers:string[];payment:{requiredAmount:number;paidAmount:number};documentId:string|null;photo:{id:string;version:number;status:string}|null;canReviewPhoto:boolean};
export function LegacyHandoverList({items}:{items:Item[]}) {
  const [preview,setPreview]=useState<string|null>(null),[previewLoaded,setPreviewLoaded]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function review(photo:NonNullable<Item["photo"]>,decision:"APPROVE"|"REJECT") {
    setBusy(true);setError("");try{const query=new URLSearchParams({id:photo.id,version:String(photo.version),decision});const response=await fetch(`/api/v1/access/legacy-photo?${query}`,{method:"POST"});const body=await response.json();if(!response.ok)throw Error(body.error);window.location.reload();}catch(error){setError(error instanceof Error?error.message:"Review unavailable");}finally{setBusy(false);}
  }
  if(!items.length)return null;
  return <section id="legacy-handovers" className="page-stack"><h2>Signed lease handovers and photo reviews</h2><p>Open the original lease and reconcile the checks before handing over keys. Existing history is retained.</p>{error&&<p role="alert" className="form-error">{error}</p>}{items.map(item=><article className="handover-check" key={item.id}>
    <h3>{item.label}</h3><p>Verified payment: R {item.payment.paidAmount.toFixed(2)} of R {item.payment.requiredAmount.toFixed(2)} recorded initial charge.</p>
    {item.documentId&&<a href={`/api/v1/documents/${encodeURIComponent(item.documentId)}/signed`} target="_blank" rel="noopener noreferrer">View signed agreement</a>}
    <p><a href={`/my?account=${encodeURIComponent(item.accountId)}&step=access-photo`} target="_blank" rel="noopener noreferrer">Open customer photo capture</a></p>
    <p>Photo: {item.photo?.status.replaceAll("_"," ")??"not submitted"}. Access activation is separate.</p>
    {item.canReviewPhoto&&item.photo?.status==="WAITING_REVIEW"&&<div><button type="button" onClick={()=>{setPreviewLoaded(false);setPreview(item.photo!.id);}}>Open photo for review</button>{preview===item.photo.id&&<div>{/* Private DLP-protected image must bypass the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/v1/access/legacy-photo?${new URLSearchParams({id:item.photo.id,version:String(item.photo.version)})}`} alt="Customer access photo for staff review" width={240} onLoad={()=>setPreviewLoaded(true)} onError={()=>{setPreviewLoaded(false);setError("The private preview could not be opened.");}} /><p>Check that the photo clearly shows the customer.</p><button type="button" disabled={busy||!previewLoaded} onClick={()=>void review(item.photo!,"APPROVE")}>Approve photo</button><button type="button" disabled={busy||!previewLoaded} onClick={()=>void review(item.photo!,"REJECT")}>Request another photo</button></div>}</div>}
    {!!item.blockers.length&&<ul>{item.blockers.map(message=><li key={message}>{message}</li>)}</ul>}
    {item.handedOver?<p>Key handover recorded.</p>:<form action={async form=>{setBusy(true);setError("");try{const result=await confirmLegacyHandoverAction(form);if(result?.error)setError(result.error);}finally{setBusy(false);}}}>
      <input type="hidden" name="tenancyId" value={item.id}/><label><input type="checkbox" name="handoverConfirmed" required disabled={!item.ready||busy}/> I matched the customer to their original identity document, checked the unit and am handing over its keys.</label><button className="button button-primary" disabled={!item.ready||busy}>Confirm move-in and key handover</button>
    </form>}
  </article>)}</section>;
}
