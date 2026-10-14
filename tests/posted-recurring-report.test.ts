import assert from 'node:assert/strict';import test from 'node:test';
import {postedBillingPeriods} from '../src/lib/posted-recurring-charge-service';
import {reportInsights} from '../src/lib/report-insights';
import {availableReports} from '../src/lib/reporting';
import {inspectReportExport} from '../src/lib/dlp-policy';
test('posted history date windows retain historical months and enforce bounded valid calendar ranges',()=>{
 assert.deepEqual(postedBillingPeriods('2025-12-15','2026-02-10'),['2025-12','2026-01','2026-02']);assert.throws(()=>postedBillingPeriods('2026-02-30','2026-03-10'),/PERIOD_INVALID/);assert.throws(()=>postedBillingPeriods('2026-03-10','2026-01-01'),/PERIOD_INVALID/);assert.throws(()=>postedBillingPeriods('2020-01-01','2026-01-01'),/LIMIT/);
});
test('online original-billing totals preserve credits and included tax while held amounts remain excluded',()=>{
 const rows=[{facility:'Synthetic',status:'POSTED',amount:'115.00',includedTax:'15.00'},{facility:'Synthetic',status:'POSTED',amount:'-11.50',includedTax:'-1.50'},{facility:'Other',status:'REVIEW',amount:null,includedTax:null}];
 const result=reportInsights('posted-recurring-charges',rows);assert.equal(result.metrics[0].value,103.5);assert.equal(result.metrics[1].value,13.5);assert.equal(result.metrics[2].value,1);assert.equal(result.bars[0].value,103.5);assert.match(result.guidance,/held invoices are excluded/);assert.match(result.guidance,/income recognition are excluded/);
});
test('posted history requires financial-report grants and stays inside classified export controls',()=>{
 assert.ok(!availableReports(['reports.sales']).some(report=>report.key==='posted-recurring-charges'));assert.ok(availableReports(['reports.financial']).some(report=>report.key==='posted-recurring-charges'));
 assert.equal(inspectReportExport('posted-recurring-charges',[{invoice:'SYNTHETIC',amount:'115.00',currency:'ZAR'}]).allowed,true);assert.equal(inspectReportExport('posted-recurring-charges',[{bankAccountNumber:'00123456789'}]).allowed,false);
});
