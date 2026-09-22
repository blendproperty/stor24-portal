import React from "react";
import { createRoot } from "react-dom/client";
import { FacialPhotoQueue } from "../../src/components/facial-photo-queue";
import { TenantFacePhoto } from "../../src/components/tenant-face-photo";
const params = new URLSearchParams(location.search);
const photo = { id:"ci-photo", version:1, status:"WAITING_REVIEW", expiresAt:"2099-10-01T12:00:00Z", customerName:"Training Customer", facilityId:"ci-store", facilityName:"Midpoint · Training", unitNumber:"101" };
createRoot(document.getElementById("root")).render(<main style={{padding:20,maxWidth:1200,margin:"auto"}}>{params.has("tenant") ? <TenantFacePhoto reservationId="ci-booking" /> : <FacialPhotoQueue photos={params.has("photo") ? [photo] : []} policyConfigured={false} manageableFacilities={params.has("readonly") ? [] : null} />}</main>);
