import React from "react";
import { createRoot } from "react-dom/client";
import { TrainingEntry, MoveInTraining } from "../../src/components/move-in-training";
import { advanceTraining, initialTrainingState } from "../../src/lib/move-in-training-contract";
const params=new URLSearchParams(location.search),manager=params.get("role")==="manager", linked=params.get("linked")==="true";
let snapshot={enabled:params.get("enabled")!=="false",controlVersion:1,canToggle:!manager,facilities:[{id:"demo",name:"Demo facility"}],facilityId:"demo",...(linked ? {booking:{reservationId:"booking-107",generation:1,unitNumber:"107",requiredAmount:2199}} : {}),run:null};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options={})=>{
 if(!String(url).startsWith("/api/v1/move-in-training"))throw new Error("Unexpected non-training request");
 if(String(url).includes("sample=true"))return nativeFetch("/sample.png");
 if(options.method==="POST"){
  const input=options.body instanceof FormData ? {action:"photo",value:"validated-sample"} : JSON.parse(options.body);
  if(input.action==="toggle"){if(manager)return Response.json({error:{message:"Forbidden"}},{status:403});snapshot={...snapshot,enabled:input.enabled,controlVersion:snapshot.controlVersion+1,run:null};}
  else if(!snapshot.enabled)return Response.json({error:{message:"Training is disabled"}},{status:409});
  else if(input.action==="start" || input.action==="reset")snapshot.run={version:(snapshot.run?.version ?? 0)+1,state:linked ? {...initialTrainingState(),unit:"unit-107",bookingRequired:2199,agreement:true,paid:params.get("paid")==="true" ? 2199 : 0} : initialTrainingState()};
  else snapshot.run={version:snapshot.run.version+1,state:advanceTraining(snapshot.run.state,input.action,input.value)};
 }
 return Response.json({data:snapshot});
};
createRoot(document.getElementById("root")).render(<main className="app-shell"><TrainingEntry/><MoveInTraining reservationId={linked ? "booking-107" : undefined}/></main>);
