import test from "node:test";
import assert from "node:assert/strict";
import { nativeUnpaidRows, type NativeUnpaidAccount } from "../src/lib/native-unpaid-report";
import { ageAccount } from "../src/lib/collections-policy";
import { defaultVisualQuery, evaluateVisualReport } from "../src/lib/visual-report-engine";
import { queryFromTemplate, visualReportTemplates } from "../src/lib/visual-report-templates";
import { visualReportDatasets } from "../src/lib/visual-report-contract";
import { visualReportScope } from "../src/lib/visual-report-security";

const now=new Date("2026-10-08T04:00:00Z");
const account=(patch:Partial<NativeUnpaidAccount>={}):NativeUnpaidAccount=>({accountNumber:"SYN",name:"Synthetic customer",facility:"Synthetic store",hold:null,ageing:{issue:null,charges:[{id:"c",description:"Rent",dueDate:"2026-10-01",remaining:1234,days:6}]},sources:[{id:"c",date:"2026-10-01"}],...patch});
test("native unpaid charges reuse approved allocation amounts including linked credits and reversals",()=>{
  const entry=(id:string,type:string,amount:string,extra:Record<string,unknown>={})=>({id,type,amount,description:id,effectiveAt:new Date("2026-10-01"),...extra});
  const entries=[entry("c","CHARGE","100.00"),entry("p","PAYMENT","25.00"),entry("credit","CREDIT","10.00",{metadata:{sourceEntryId:"c"}}),entry("reversal","REVERSAL","5.00",{reversalOfId:"p"})];
  const ageing=ageAccount(entries,"70.00","2026-10-07",{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"Synthetic approval"});
  assert.equal(ageing.issue,null);assert.equal(nativeUnpaidRows([account({ageing})],"2026-10-07",false,now)[0].amount,"70.00");
});
test("quarantined accounts retain a review row and prevent plausible money totals",()=>{
  const rows=[account(),account({accountNumber:"REVIEW",ageing:{issue:"Receipt evidence needs reconciliation",charges:[]}})];
  const output=nativeUnpaidRows(rows,"2026-10-07",false,now);
  assert.equal(output[0].amount,"12.34");assert.equal(output[1].amount,null);assert.equal(output[1].currency,null);assert.match(String(output[1].review),/reconciliation/);
  assert.throws(()=>nativeUnpaidRows(rows,"2026-10-07",true,now),/REPORT_FINANCE_REVIEW_REQUIRED/);
});
test("native unpaid reports preserve exact safe cent amounts, paid charges and source bounds",()=>{
  const charge={id:"large",description:"Synthetic large charge",dueDate:"2026-10-09",remaining:Number.MAX_SAFE_INTEGER,days:-2};
  const output=nativeUnpaidRows([account({ageing:{issue:null,charges:[charge,{...charge,id:"paid",remaining:0}]}})],"2026-10-07",false,now);
  assert.equal(output.length,1);assert.equal(output[0].amount,"90071992547409.91");assert.equal(output[0].daysLate,0);
  assert.throws(()=>nativeUnpaidRows([account({ageing:{issue:null,charges:[{...charge,remaining:1.1}]}})],"2026-10-07",false,now),/INVALID_REPORT_AMOUNT/);
  assert.throws(()=>nativeUnpaidRows([account({ageing:{issue:null,charges:Array.from({length:5001},()=>charge)}})],"2026-10-07",false,now),/REPORT_LIMIT/);
  assert.throws(()=>nativeUnpaidRows([],"2026-10-09",false,now),/REPORT_ASOF_FUTURE/);
});
test("unpaid-charge totals and access retain currency and intersect finance and collections grants",()=>{
  const query={...defaultVisualQuery("unpaid-native","2026-10-01","2026-10-07"),groupBy:["currency"],metrics:[{field:"amount",operation:"sum" as const}]};
  assert.equal(evaluateVisualReport(query,nativeUnpaidRows([account()],query.to,true,now)).rows[0].sum_amount,"12.34");
  const dataset=visualReportDatasets.find(d=>d.key==="unpaid-native")!;
  const assignments=[{facilityId:"a",role:{name:"Staff",permissions:["reports.financial"]}},{facilityId:"b",role:{name:"Staff",permissions:["collections.view"]}}];
  assert.throws(()=>visualReportScope(assignments,dataset,"staff","org"),/FORBIDDEN/);
  assignments.push({facilityId:"a",role:{name:"Staff",permissions:["collections.view"]}});
  assert.deepEqual(visualReportScope(assignments,dataset,"staff","org").facilityIds,["a"]);
  assert.throws(()=>visualReportScope(assignments,dataset,"staff","org",undefined,true),/FORBIDDEN/);
});
test("native sign-in counts distinguish success, failure and MFA events from unrelated staff actions",()=>{
  const template=visualReportTemplates.find(t=>t.key==="native-sign-ins")!;
  const query=queryFromTemplate(template,"2026-10-01","2026-10-07");
  const rows=evaluateVisualReport(query,[{actor:"Synthetic",action:"user.login.succeeded",date:"2026-10-01"},{actor:"Synthetic",action:"user.login.failed",date:"2026-10-01"},{actor:"Synthetic",action:"user.login.mfa_required",date:"2026-10-01"},{actor:"Synthetic",action:"billing.month_posted",date:"2026-10-01"}]).rows;
  assert.equal(rows.length,3);assert.ok(rows.every(row=>row["count_*"]===1));
});
