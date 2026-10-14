import assert from 'node:assert/strict';import test from 'node:test';
import {postedBillingPeriods} from '../src/lib/posted-recurring-charge-service';
import {reportInsights} from '../src/lib/report-insights';
import {availableReports} from '../src/lib/reporting';
import {inspectReportExport} from '../src/lib/dlp-policy';
test('posted history date windows retain historical months and enforce bounded valid calendar ranges',()=>{
 assert.deepEqual(postedBillingPeriods('2025-12-15','2026-02-10'),['2025-12','2026-01','2026-02']);assert.throws(()=>postedBillingPeriods('2026-02-30','2026-03-10'),/PERIOD_INVALID/);assert.throws(()=>postedBillingPeriods('2026-03-10','2026-01-01'),/PERIOD_INVALID/);assert.throws(()=>postedBillingPeriods('2020-01-01','2026-01-01'),/LIMIT/);
});
test('online original-billing totals preserve credits and included tax while held amounts remain excluded',()=>{
 const rows=[{facility:'Synthetic',facilityId:'a',facilityCode:'A',status:'POSTED',amount:'115.00',includedTax:'15.00'},{facility:'Synthetic',facilityId:'a',facilityCode:'A',status:'POSTED',amount:'-11.50',includedTax:'-1.50'},{facility:'Other',facilityId:'b',facilityCode:'B',status:'REVIEW',amount:null,includedTax:null}];
 const result=reportInsights('posted-recurring-charges',rows);assert.equal(result.metrics[0].value,103.5);assert.equal(result.metrics[1].value,13.5);assert.equal(result.metrics[2].value,1);assert.equal(result.bars[0].value,103.5);assert.match(result.guidance,/held invoices are excluded/);assert.match(result.guidance,/income recognition are excluded/);
});
test('recurring totals keep identically named stores separate using real identities and codes',()=>{
 const rows=[{facility:'Shared name',facilityId:'a',facilityCode:'FIRST',account:'SYN-1',amount:'115.00',includedTax:'15.00'},{facility:'Shared name',facilityId:'a',facilityCode:'FIRST',account:'SYN-1',amount:'-11.50',includedTax:'-1.50'},{facility:'Shared name',facilityId:'b',facilityCode:'SECOND',account:'SYN-2',amount:'230.00',includedTax:'30.00'}];
 for(const key of ['recurring-charges','posted-recurring-charges']){
  const source=rows.map(row=>({...row,status:key==='recurring-charges'?'READY':'POSTED'})),before=structuredClone(source),result=reportInsights(key,source);assert.equal(result.metrics[0].value,333.5);assert.deepEqual(result.bars,[{label:'Shared name · FIRST',value:103.5},{label:'Shared name · SECOND',value:230}]);assert.deepEqual(source,before);
 }
});
test('missing or inconsistent store identities hold financial summaries rather than guessing name groups',()=>{
 const row={facility:'Shared',facilityId:'a',facilityCode:'FIRST',account:'SYN-1',amount:'115.00',includedTax:'15.00'};
 for(const key of ['recurring-charges','posted-recurring-charges']){
  const status=key==='recurring-charges'?'READY':'POSTED',source={...row,status};
  for(const rows of [[{...source,facilityId:null}],[source,{...source,facility:'Changed'}],[source,{...source,facilityId:'b'}],[{...source,amount:null}],[{...source,amount:1e20}]])assert.throws(()=>reportInsights(key,rows),/RECURRING_SOURCE_REVIEW|POSTED_REPORT_/);
 }
});
test('posted history requires financial-report grants and stays inside classified export controls',()=>{
 assert.ok(!availableReports(['reports.sales']).some(report=>report.key==='posted-recurring-charges'));assert.ok(availableReports(['reports.financial']).some(report=>report.key==='posted-recurring-charges'));
 assert.equal(inspectReportExport('posted-recurring-charges',[{invoice:'SYNTHETIC',amount:'115.00',currency:'ZAR'}]).allowed,true);assert.equal(inspectReportExport('posted-recurring-charges',[{bankAccountNumber:'00123456789'}]).allowed,false);
});
