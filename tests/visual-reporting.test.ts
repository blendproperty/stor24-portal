import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {defaultVisualQuery,evaluateVisualReport,nextReportRun,reportPeriod} from "../src/lib/visual-report-engine";
import {visualReportDatasets,visualReportSchema} from "../src/lib/visual-report-contract";
import {queryFromTemplate,visualReportTemplates} from "../src/lib/visual-report-templates";
import {visualReportScope,personalReportAccess,encryptReportArtifact,decryptReportArtifact} from "../src/lib/visual-report-security";
import {reportBundle} from "../src/lib/report-bundle";
import {inspectReportExport} from "../src/lib/dlp-policy";
const query=(dataset="units")=>defaultVisualQuery(dataset,"2026-10-01","2026-10-31");
test("visual builder rejects SQL, unknown fields, nested values and incompatible operators",()=>{
  for(const patch of [{dataset:"SELECT * FROM Users"},{columns:["passwordHash"]},{columns:["unit","unit"]},{sql:"SELECT 1"},{filters:[{field:"monthlyRate",operator:"contains",value:"1"}]},{filters:[{field:"unit",operator:"gt",value:"B"}]},{filters:[{field:"operational",operator:"eq",value:"true"}]},{sort:{field:"passwordHash",direction:"asc"}}])assert.equal(visualReportSchema.safeParse({...query(),...patch}).success,false);
});
test("all executable templates validate and every dataset has unique fields",()=>{
  for(const t of visualReportTemplates.filter(t=>t.dataset))assert.doesNotThrow(()=>queryFromTemplate(t,"2026-10-01","2026-10-31"),t.key);
  assert.equal(new Set(visualReportTemplates.map(t=>t.key)).size,visualReportTemplates.length);
  for(const d of visualReportDatasets)assert.equal(new Set(d.fields.map(f=>f.key)).size,d.fields.length);
});
test("filters combine with AND, retain zero, and treat missing data explicitly",()=>{
  const result=evaluateVisualReport({...query(),columns:["unit","monthlyRate"],filters:[{field:"unit",operator:"contains",value:"a"},{field:"monthlyRate",operator:"gte",value:0}]},[{unit:"A1",monthlyRate:"0.00"},{unit:"A2",monthlyRate:null},{unit:"B1",monthlyRate:"10.00"}]);
  assert.deepEqual(result.rows,[{unit:"A1",monthlyRate:"0.00"}]);
  assert.equal(evaluateVisualReport({...query(),filters:[{field:"monthlyRate",operator:"isEmpty"}]},[{monthlyRate:null},{monthlyRate:"0.00"}]).matchedRows,1);
});
test("date filtering and equality use South African calendar boundaries",()=>{
  const input={...query("leads"),from:"2026-10-01",to:"2026-10-01",columns:["date"],dateField:"date",filters:[{field:"date",operator:"eq",value:"2026-10-01"}]};
  const rows=evaluateVisualReport(input,[{date:"2026-09-30T21:59:59.999Z"},{date:"2026-09-30T22:00:00.000Z"},{date:"2026-10-01T21:59:59.999Z"},{date:"2026-10-01T22:00:00.000Z"},{date:null}]).rows;
  assert.equal(rows.length,2);
});
test("grouping preserves exact large money totals, nulls and record counts",()=>{
  const result=evaluateVisualReport({...query("tenants"),groupBy:["facility","currency"],metrics:[{field:"balance",operation:"sum"},{field:"balance",operation:"average"},{field:"*",operation:"count"}]},[{facility:"A",currency:"ZAR",balance:"90071992547409.91"},{facility:"A",currency:"ZAR",balance:"0.09"},{facility:"A",currency:"ZAR",balance:null},{facility:"B",currency:"ZAR",balance:null}]);
  assert.equal(result.rows[0].sum_balance,"90071992547410.00");assert.equal(result.rows[0].average_balance,"45035996273705.00");assert.equal(result.rows[0]["count_*"],3);assert.equal(result.rows[1].sum_balance,null);
  assert.equal(visualReportSchema.safeParse({...query("tenants"),metrics:[{field:"balance",operation:"sum"}]}).success,false);
});
test("groups and selected columns cannot create prototype keys or collide",()=>{
  assert.equal(visualReportSchema.safeParse({...query(),columns:["__proto__"]}).success,false);
  assert.equal(visualReportSchema.safeParse({...query(),metrics:[{field:"*",operation:"count"},{field:"*",operation:"count"}]}).success,false);
  assert.deepEqual(evaluateVisualReport({...query(),groupBy:["facility"],metrics:[{field:"*",operation:"count"}],sort:{field:"count_*",direction:"desc"}},[{facility:"__proto__"},{facility:"A"},{facility:"A"}]).rows,[{facility:"A","count_*":2},{facility:"__proto__","count_*":1}]);
});
test("source limits apply before aggregates and never silently truncate",()=>{
  assert.throws(()=>evaluateVisualReport({...query(),metrics:[{field:"*",operation:"count"}]},Array.from({length:5001},()=>({unit:"A"}))),/REPORT_LIMIT/);
  assert.deepEqual(evaluateVisualReport({...query(),metrics:[{field:"*",operation:"count"}]},[]).rows,[{"count_*":0}]);
});
test("whole-period occupancy and overlap remain distinct at exact boundaries",()=>{
  const rows=[{unit:"A",start:"2026-09-01T00:00:00+02:00",end:null},{unit:"B",start:"2026-10-15T00:00:00+02:00",end:null},{unit:"C",start:"2026-09-01T00:00:00+02:00",end:"2026-10-01T00:00:00+02:00"},{unit:"D",start:"2026-09-01T00:00:00+02:00",end:"2026-11-01T00:00:00+02:00"}];
  const base={...query("occupancies"),columns:["unit"]};assert.deepEqual(evaluateVisualReport({...base,intervalMode:"whole-period"},rows).rows,[{unit:"A"},{unit:"D"}]);assert.deepEqual(evaluateVisualReport({...base,intervalMode:"overlap"},rows).rows,[{unit:"A"},{unit:"B"},{unit:"D"}]);
});
test("dataset and download permissions intersect across facilities",()=>{
  const dataset=visualReportDatasets.find(d=>d.key==="insurance")!;
  const assignments=[{facilityId:"a",role:{name:"Staff",permissions:["reports.view","reports.export"]}},{facilityId:"b",role:{name:"Staff",permissions:["operations.view","reports.export"]}}];
  assert.throws(()=>visualReportScope(assignments,dataset,"staff","org"),/FORBIDDEN/);
  assignments.push({facilityId:"a",role:{name:"Staff",permissions:["operations.view"]}});
  const scope=visualReportScope(assignments,dataset,"staff","org",undefined,true);assert.deepEqual(scope.facilityIds,["a"]);
  assert.throws(()=>visualReportScope(assignments,dataset,"staff","org","b",true),/FORBIDDEN/);
  assert.equal(personalReportAccess([{facilityId:null,role:{name:"Admin",permissions:["*"]}}],scope),false);
  assert.equal(personalReportAccess([{facilityId:null,role:{name:"Organisation owner",permissions:[]}}],scope),true);
});
test("snapshot encryption authenticates organisation, actor and run binding",()=>{
  const previous=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="reporting-test-key-not-a-credential-123456";
  try{const encrypted=encryptReportArtifact("synthetic rows","org:actor:run");assert.equal(decryptReportArtifact(encrypted,"org:actor:run"),"synthetic rows");const parts=encrypted.split(".");for(const size of [4,8,12,15]){const truncated=[...parts];truncated[2]=Buffer.from(parts[2],"base64url").subarray(0,size).toString("base64url");assert.throws(()=>decryptReportArtifact(truncated.join("."),"org:actor:run"));}const invalidNonce=[...parts];invalidNonce[1]=Buffer.alloc(8).toString("base64url");assert.throws(()=>decryptReportArtifact(invalidNonce.join("."),"org:actor:run"));assert.throws(()=>decryptReportArtifact(encrypted,"other:actor:run"));assert.throws(()=>decryptReportArtifact(encrypted.slice(0,-2)+"zz","org:actor:run"));}finally{if(previous===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=previous;}
});
test("schedules use 08:00 SAST and previous complete reporting periods",()=>{
  assert.equal(nextReportRun("daily",new Date("2026-10-07T05:59:00Z")).toISOString(),"2026-10-07T06:00:00.000Z");
  assert.equal(nextReportRun("daily",new Date("2026-10-07T06:00:00Z")).toISOString(),"2026-10-08T06:00:00.000Z");
  assert.equal(nextReportRun("weekly",new Date("2026-10-07T12:00:00Z")).toISOString(),"2026-10-12T06:00:00.000Z");
  assert.deepEqual(reportPeriod("monthly",new Date("2028-03-01T06:00:00Z")),{from:"2028-02-01",to:"2028-02-29"});
  assert.deepEqual(reportPeriod("weekly",new Date("2026-10-12T06:00:00Z")),{from:"2026-10-05",to:"2026-10-11"});
  assert.deepEqual(reportPeriod("daily",new Date("2026-10-06T22:01:00Z")),{from:"2026-10-06",to:"2026-10-06"});
});
test("report bundles can be opened with independent ZIP reader and reject paths",async()=>{
  const JSZip=createRequire(import.meta.url)("jszip");const buffer=reportBundle([{name:"report.csv",bytes:Buffer.from('"Unit"\r\n"A1"')},{name:"manifest.json",bytes:Buffer.from("[]")}]);
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});assert.equal(await zip.file("report.csv").async("string"),'"Unit"\r\n"A1"');assert.equal(await zip.file("manifest.json").async("string"),"[]");
  assert.throws(()=>reportBundle([{name:"../secret.csv",bytes:Buffer.from("x")}]),/INVALID_BUNDLE_NAME/);
});
test("visual report classification retains secret and credential rejection",()=>{
  assert.equal(inspectReportExport("visual-report",[{unit:"A1"}]).allowed,true);
  assert.equal(inspectReportExport("visual-report",[{passwordHash:"never-export"}]).allowed,false);
  assert.equal(inspectReportExport("visual-report",[{unit:{secret:"x"}}]).allowed,false);
});

test("money filter strings retain exact cents beyond floating-point precision",()=>{
  const input={...query(),columns:["monthlyRate"],filters:[{field:"monthlyRate",operator:"eq",value:"90071992547409.91"}]};
  assert.deepEqual(evaluateVisualReport(input,[{monthlyRate:"90071992547409.91"},{monthlyRate:"90071992547409.92"}]).rows,[{monthlyRate:"90071992547409.91"}]);
  assert.equal(visualReportSchema.safeParse({...input,filters:[{field:"monthlyRate",operator:"eq",value:"1.234"}]}).success,false);
});
