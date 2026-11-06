import React from "react";
import { createRoot } from "react-dom/client";
import { TenantFacePhoto } from "../../src/components/tenant-face-photo";
import { LegacyHandoverList } from "../../src/components/legacy-handover-list";
const staff=location.search.includes("staff");
createRoot(document.getElementById("root")).render(staff?<LegacyHandoverList items={[{id:"ci-lease",accountId:"ci-account",label:"Test store · Unit 1 · Test customer",ready:true,handedOver:false,blockers:[],payment:{requiredAmount:100,paidAmount:100},documentId:"ci-document",photo:{id:"ci-photo",version:1,status:"WAITING_REVIEW"},canReviewPhoto:true}]}/>:<TenantFacePhoto tenancyId="ci-lease"/>);
