import React from "react";
import { createRoot } from "react-dom/client";
import { TrainingEntry, MoveInTraining } from "../../src/components/move-in-training";
import { advanceTraining, initialTrainingState } from "../../src/lib/move-in-training-contract";
const params=new URLSearchParams(location.search),manager=params.get("role")==="manager";
let snapshot={enabled:params.get("enabled")!=="false",controlVersion:1,canToggle:!manager,facilities:[{id:"demo",name:"Demo facility"}],facilityId:"demo",run:null};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options={})=>{
 if(!String(url).startsWith("/api/v1/move-in-training"))throw new Error("Unexpected non-training request");
 if(String(url).includes("sample=true"))return nativeFetch("/sample.png");
 if(options.method==="POST"){
  const input=options.body instanceof FormData ? {action:"photo",value:"validated-sample"} : JSON.parse(options.body);
  if(input.action==="toggle"){if(manager)return Response.json({error:{message:"Forbidden"}},{status:403});snapshot={...snapshot,enabled:input.enabled,controlVersion:snapshot.controlVersion+1,run:null};}
  else if(!snapshot.enabled)return Response.json({error:{message:"Training is disabled"}},{status:409});
  else if(input.action==="start" || input.action==="reset")snapshot.run={version:1,state:initialTrainingState()};
  else snapshot.run={version:snapshot.run.version+1,state:advanceTraining(snapshot.run.state,input.action,input.value)};
 }
 return Response.json({data:snapshot});
};
createRoot(document.getElementById("root")).render(<main className="app-shell"><TrainingEntry/><MoveInTraining/></main>);
