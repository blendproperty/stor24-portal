import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {PDFDocument} from "pdf-lib";
import {reportExcel,reportPdf} from "../src/lib/report-documents";
import {reportInsights} from "../src/lib/report-insights";
test("Excel preserves typed amounts, blank reconciliation values and formula-shaped text as text",async()=>{
 const bytes=await reportExcel("Accounts","rent-roll",[{account:"=HYPERLINK(\"bad\")",balance:1250.25,monthlyRate:null}],"Current snapshot");
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes.buffer as ArrayBuffer);const sheet=book.getWorksheet("Data")!;
 assert.equal(sheet.getCell("A2").type,ExcelJS.ValueType.String);assert.equal(sheet.getCell("A2").value,'=HYPERLINK("bad")');assert.equal(sheet.getCell("B2").value,1250.25);assert.equal(sheet.getCell("C2").value,"");assert.equal(book.worksheets.length,2);
});
test("PDF paginates complete detail records and retains a meaningful title",async()=>{
 const rows=Array.from({length:40},(_,i)=>({account:`Account${i}`,balance:i*100,customer:"Test customer",monthlyRate:500}));const bytes=await reportPdf("Rent roll","rent-roll",rows,"2026-10-01 to 2026-10-06 SAST");const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getTitle(),"Rent roll");assert.ok(pdf.getPageCount()>2);
});
test("ageing charts exclude unresolved balances and show reconciliation exceptions",()=>{
 const insight=reportInsights("receivables-ageing",[{current:null,overdue:null,days91Plus:null,reviewReason:"Missing approved terms"},{current:"100.25",overdue:"250",days91Plus:"250",reviewReason:null}]);assert.equal(insight.metrics.find(m=>m.label==="Overdue")?.value,250);assert.equal(insight.metrics.find(m=>m.label==="Needs reconciliation")?.value,1);assert.equal(insight.bars.find(b=>b.label==="current")?.value,100.25);
});

test("availability summary uses operational ground-floor product eligibility",()=>{const insight=reportInsights("unit-availability",[{products:"STORAGE | MICRO_WAREHOUSE",floorOperational:true,microGroundFloorEligible:false,effectiveStatus:"AVAILABLE"},{products:"STORAGE | MICRO_WAREHOUSE",floorOperational:true,microGroundFloorEligible:true,effectiveStatus:"AVAILABLE"}]);assert.equal(insight.metrics.find(m=>m.label==="Micro ground-floor eligible")?.value,1);});

test("custom Excel reports describe result rows without inferring facility or financial summaries",async()=>{
 const bytes=await reportExcel("Selected totals","visual-report",[{Store:"Recorded store",Total:"90071992547409.91",Review:null}],"Approved source basis");
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes.buffer as ArrayBuffer);
 const summary=book.getWorksheet("Summary")!,data=book.getWorksheet("Data")!;
 assert.equal(summary.getCell("A6").value,"Result rows");assert.equal(summary.getCell("B6").value,1);
 assert.equal(data.getCell("B2").value,"90071992547409.91");assert.equal(data.getCell("C2").value,"");
 assert.equal(data.pageSetup.orientation,"landscape");assert.equal(data.pageSetup.fitToHeight,0);
 assert.ok(!JSON.stringify(summary.getSheetValues()).includes("Not recorded"));
});

test("custom PDF compacts 530 seven-column rows and paginates wide and long fields",async()=>{
 const rows=Array.from({length:530},(_,i)=>({Store:"Recorded store",Unit:`U-${i+1}`,Floor:"Ground floor",Type:"Storage",Area:36,Rent:"90071992547409.91",Status:"AVAILABLE"}));
 const bytes=await reportPdf("Price list","visual-report",rows,"Current recorded unit inventory");
 const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getTitle(),"Price list");assert.ok(pdf.getPageCount()<60);assert.ok(pdf.getPageCount()>1);
 const wide=Object.fromEntries(Array.from({length:15},(_,i)=>[`Selected field ${i+1}`,i===14?"Long note ".repeat(500)+"END-MARKER":`value-${i+1}`]));
 const widePdf=await PDFDocument.load(await reportPdf("Complete wide report","visual-report",[wide],"Recorded source basis"));assert.ok(widePdf.getPageCount()>=3);
 const continued={Note:"Long note ".repeat(500)+"END-MARKER",A:"a",B:"b",C:"c",D:"d",E:"e",F:"f"};assert.ok((await PDFDocument.load(await reportPdf("Continued note","visual-report",[continued],"Source basis"))).getPageCount()>1);
 const empty=await PDFDocument.load(await reportPdf("Empty report","visual-report",[],"Current source snapshot"));assert.equal(empty.getPageCount(),1);
});
