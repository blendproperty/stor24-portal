import assert from "node:assert/strict";
import test from "node:test";
import {debitTestReadiness} from "../src/lib/debit-test-readiness";
const now=new Date('2026-10-14T22:30:00Z'),run={status:'PREPARED',environment:'sandbox',actionDate:'2026-10-16',instructions:[{accountId:'synthetic-a'},{accountId:'synthetic-b'}]},settings={enabled:'true',accountIds:'synthetic-a, synthetic-b',actionDates:'2026-10-16'};
test('configured test gates are individually explained without approving provider authority or exposing allowlists',()=>{
 const before=structuredClone({run,settings}),ready=debitTestReadiness(run,settings,now);assert.equal(ready.configurationAllowsTestRequest,true);assert.ok(ready.checks.every(check=>check.passed));assert.equal(ready.liveSubmissionSupported,false);assert.equal(ready.financialReceipt,false);assert.equal(ready.accountsMissingAllowlist,0);assert.ok(!JSON.stringify(ready).includes('synthetic-a'));assert.deepEqual({run,settings},before);
 const disabled=debitTestReadiness(run,{},now);assert.equal(disabled.configurationAllowsTestRequest,false);assert.equal(disabled.accountsMissingAllowlist,2);assert.deepEqual(disabled.checks.filter(check=>!check.passed).map(check=>check.key),['switch','date-allowlist','account-allowlist']);
});
test('readiness holds live, attempted, empty, missing-account and expired or invalid SAST dates',()=>{
 for(const value of [{...run,environment:'live'},{...run,status:'SUBMITTED'},{...run,instructions:[]},{...run,instructions:[{accountId:'not-listed'}]},{...run,actionDate:'2026-10-15'},{...run,actionDate:'2026-02-30'}])assert.equal(debitTestReadiness(value,settings,now).configurationAllowsTestRequest,false);
 assert.equal(debitTestReadiness({...run,actionDate:'2026-02-30'},{...settings,actionDates:'2026-02-30'},now).checks.find(check=>check.key==='future-date')?.passed,false);
 assert.equal(debitTestReadiness(run,{...settings,enabled:'TRUE'},now).configurationAllowsTestRequest,false);
});
