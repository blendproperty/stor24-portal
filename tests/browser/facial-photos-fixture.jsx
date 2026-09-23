import React from "react";
import { createRoot } from "react-dom/client";
import { FacialPhotoQueue } from "../../src/components/facial-photo-queue";
import { TenantFacePhoto } from "../../src/components/tenant-face-photo";
import { PhotoCollectionControl } from "../../src/components/photo-collection-control";
const params = new URLSearchParams(location.search);
const photo = { id:"ci-photo", version:1, status:"WAITING_REVIEW", expiresAt:"2099-10-01T12:00:00Z", customerName:"Training Customer", facilityId:"ci-store", facilityName:"Midpoint · Training", unitNumber:"101" };
createRoot(document.getElementById("root")).render(params.has("tenant") ? <div className="tenant-portal" style={{fontFamily:'"Satoshi Handover", Arial, sans-serif'}}><main className="tenant-body" style={{maxWidth:1040}}><p style={{fontSize:10,letterSpacing:1.5,margin:"0 0 16px",color:"#59695e"}}>MY STOR24 / PREPARE FOR MOVE-IN</p><TenantFacePhoto reservationId="ci-booking" /></main></div> : <main style={{padding:20,maxWidth:1200,margin:"auto"}}><PhotoCollectionControl initial={{enabled:params.has("policy"),version:0,canToggle:!params.has("readonly"),storageReady:true,maintenanceReady:true,reviewStatus:"Interim  -  awaiting review"}} /><FacialPhotoQueue photos={params.has("photo") ? [photo] : []} policyConfigured={params.has("policy")} manageableFacilities={params.has("readonly") ? [] : null} /></main>);
