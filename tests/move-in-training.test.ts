import test from "node:test";
import assert from "node:assert/strict";
import { advanceTraining, initialTrainingState, trainingReady } from "../src/lib/move-in-training-contract";
test("training requires each check, full payment and fresh photo approval",()=>{
 let state=initialTrainingState();
 assert.throws(()=>advanceTraining(state,"handover","confirmed"),/STEP_REQUIRED/);
 state=advanceTraining(state,"unit","DEMO-01");state=advanceTraining(state,"agreement","confirmed");
 state=advanceTraining(state,"payment","0.02");assert.throws(()=>advanceTraining(state,"identity","confirmed"),/STEP_REQUIRED/);
 state=advanceTraining(state,"payment","99.98");state=advanceTraining(state,"identity","confirmed");
 state=advanceTraining(state,"photo","validated-sample");assert.throws(()=>advanceTraining(state,"approve"),/STEP_REQUIRED/);
 state=advanceTraining(state,"preview");state=advanceTraining(state,"reject");assert.equal(trainingReady(state),false);
 state=advanceTraining(state,"photo","validated-sample");assert.equal(state.previewed,false);
 state=advanceTraining(state,"preview");state=advanceTraining(state,"approve");assert.equal(trainingReady(state),true);
 state=advanceTraining(state,"handover","confirmed");assert.ok(state.handedOverAt);
 assert.throws(()=>advanceTraining(state,"payment","100"),/FINISHED/);
});
test("training rejects live unit identifiers and invalid amounts",()=>{
 assert.throws(()=>advanceTraining(initialTrainingState(),"unit","live-unit"),/STEP_REQUIRED/);
 const state={...initialTrainingState(),unit:"DEMO-01",agreement:true};
 for(const amount of ["NaN","Infinity","-1","0","0.001","10001"])assert.throws(()=>advanceTraining(state,"payment",amount),/STEP_REQUIRED/);
});
