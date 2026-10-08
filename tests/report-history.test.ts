import assert from "node:assert/strict";
import test from "node:test";
import {historyImportSchema,prepareReportHistory,reportCsvRows} from "../src/lib/report-history-contract";
import {reportRequestBody} from "../src/lib/report-request-body";
import {historicalReportDatasets} from "../src/lib/historical-report-datasets";
const fixture=()=>historyImportSchema.parse({kind:"validate",dataset:"ledger",facilityId:"a",name:"SiteLink synthetic history",extractedAt:"2026-10-07T08:00:00+02:00",approvalReference:"Fixture reconciliation",csv:'ID,Amount,Currency,Date,Description\r\n1,0.01,ZAR,2026-10-01,"Rent, first month"\r\n2,-0.01,ZAR,2026-10-02,Reversal',mapping:{sourceRecordId:"ID",amount:"Amount",currency:"Currency",date:"Date",description:"Description"}});
test("history mapping retains source money, dates, nulls and trusted store label",()=>{const result=prepareReportHistory(fixture(),"Permitted store");assert.equal(result.rows.length,2);assert.equal(result.rows[0].amount,"0.01");assert.equal(result.rows[1].amount,"-0.01");assert.equal(result.rows[0].facility,"Permitted store");assert.equal(result.rows[0].description,"Rent, first month");assert.equal(result.rows[0].account,null);assert.ok(result.unmappedFields.includes("account"));assert.equal("sourceRecordId" in result.rows[0],false);});
test("CSV rejects inconsistent quoting, duplicate headers, missing IDs and currency",()=>{
  for(const csv of ['ID,Amount,Currency\n1,"open,ZAR','ID,ID\n1,2','ID,Amount,Currency,Date,Description\n1,1,ZAR','ID,Amount,Currency,Date,Description\n1,1,ZAR,2026-10-01,a\n1,2,ZAR,2026-10-01,b'])assert.throws(()=>prepareReportHistory({...fixture(),csv},"A"));
  assert.throws(()=>prepareReportHistory({...fixture(),mapping:{sourceRecordId:"ID",amount:"Amount"}},"A"),/REPORT_HISTORY_CURRENCY/);
  assert.throws(()=>prepareReportHistory({...fixture(),mapping:{...fixture().mapping,passwordHash:"Description"}},"A"),/REPORT_HISTORY_MAPPING/);
});
test("CSV parser preserves quoted multiline and escaped quotes",()=>{assert.deepEqual(reportCsvRows('a,b\r\n"first\nsecond","say ""hi"""'),[['a','b'],['first\nsecond','say "hi"']]);});
test("imports reject credentials, invalid dates and excessive precision",()=>{
  for(const csv of ['ID,Amount,Currency,Date,Description\n1,1.001,ZAR,2026-10-01,a','ID,Amount,Currency,Date,Description\n1,1,ZAR,2026-02-30,a','ID,Amount,Currency,Date,Description\n1,1,ZAR,2026-10-01,Bearer abcdefghijklmnopqrstu'])assert.throws(()=>prepareReportHistory({...fixture(),csv},"A"));
});
test("streamed request bounds reject before full payload allocation",async()=>{const request=new Request("https://fixture.invalid",{method:"POST",body:'{"data":"'+'a'.repeat(1000)+'"}'});await assert.rejects(()=>reportRequestBody(request,100),/REPORT_REQUEST_LIMIT/);assert.deepEqual(await reportRequestBody(new Request("https://fixture.invalid",{method:"POST",body:'{"data":1}'}),100),{data:1});});

test("monetary history cannot hide an unrecorded currency in a mapped column",()=>{
  const input=historyImportSchema.parse({kind:"validate",dataset:"units",facilityId:"a",name:"Synthetic",extractedAt:"2026-10-01T06:00:00Z",approvalReference:"Synthetic review",csv:"id,price,currency\\n1,10.00,".replace("\\n","\n"),mapping:{sourceRecordId:"id",monthlyRate:"price",currency:"currency"}});
  assert.throws(()=>prepareReportHistory(input,"Fixture"),/REPORT_HISTORY_CURRENCY/);
});

test("every specialized history report requires complete typed source fields",()=>{
  assert.equal(historicalReportDatasets.length,27);
  for(const dataset of historicalReportDatasets){
    const fields=dataset.fields.filter(f=>f.key!=="facility");
    const value=(type:string,key:string)=>key==="currency"?"ZAR":type==="date"?"2026-10-01":type==="money"?"12.34":type==="number"?"2":type==="boolean"?"true":"Synthetic source";
    const input={...fixture(),dataset:dataset.key,csv:[['id',...fields.map(f=>f.key)].join(','),['1',...fields.map(f=>value(f.type,f.key))].join(',')].join('\n'),mapping:{sourceRecordId:"id",...Object.fromEntries(fields.map(f=>[f.key,f.key]))}};
    assert.equal(prepareReportHistory(input,"Fixture store").rows.length,1,dataset.key);
    const mapping:Record<string,string>={...input.mapping};delete mapping[dataset.requiredFields![0]];
    assert.throws(()=>prepareReportHistory({...input,mapping},"Fixture store"),/REPORT_HISTORY_REQUIRED_FIELDS/,dataset.key);
    const cells=['1',...fields.map(f=>f.key===dataset.requiredFields![0]?"":value(f.type,f.key))];
    assert.throws(()=>prepareReportHistory({...input,csv:[['id',...fields.map(f=>f.key)].join(','),cells.join(',')].join('\n')},"Fixture store"),/REPORT_HISTORY_REQUIRED_FIELDS/,dataset.key);
  }
});
