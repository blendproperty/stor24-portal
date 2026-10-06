import fontkit from "@pdf-lib/fontkit";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, rgb } from "pdf-lib";
import type { ReportRow } from "./report-data-service";
import { reportInsights } from "./report-insights";
let fontBytes:Promise<Buffer>|undefined;
const heading=(s:string)=>s.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,c=>c.toUpperCase());
export async function reportExcel(title:string,key:string,rows:ReportRow[],period:string){
 const book=new ExcelJS.Workbook();book.creator="STOR24";book.created=new Date();
 const summary=book.addWorksheet("Summary");summary.addRow([title]);summary.addRow([period]);summary.addRow(["Generated",new Date().toISOString()]);summary.addRow(["Confidential — authorised recipients only"]);
 const insights=reportInsights(key,rows);summary.addRow([]);for(const m of insights.metrics)summary.addRow([m.label,m.value]);summary.addRow([insights.chartTitle]);for(const b of insights.bars)summary.addRow([b.label,b.value]);summary.addRow([insights.guidance]);summary.columns=[{width:75},{width:25}];
 const sheet=book.addWorksheet("Data",{views:[{state:"frozen",ySplit:1}]});const headers=Object.keys(rows[0]??{});sheet.addRow(headers.map(heading));for(const row of rows)sheet.addRow(headers.map(h=>row[h]??""));sheet.columns=headers.map(()=>({width:25}));if(headers.length)sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:headers.length}};
 for(const page of [summary,sheet]){page.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};page.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF153B30"}};}
 return new Uint8Array(await book.xlsx.writeBuffer());
}
export async function reportPdf(title:string,key:string,rows:ReportRow[],period:string){
 const pdf=await PDFDocument.create();pdf.setTitle(title);pdf.registerFontkit(fontkit);fontBytes ??= readFile(join(process.cwd(),"public","brand","Satoshi-Variable.ttf"));const font=await pdf.embedFont(await fontBytes,{subset:true}),bold=font;let page=pdf.addPage([842,595]),y=550;
 const clean=(s:string)=>s.replace(/[\x00-\x1f\x7f]/g," ");
 const line=(text:string,size=10,strong=false)=>{if(y<45){page=pdf.addPage([842,595]);y=550;}page.drawText(clean(text),{x:35,y,size,font:strong?bold:font,color:rgb(.03,.15,.12)});y-=size+9;};
 const wrap=(text:string)=>{let part="";for(const character of clean(text)){if(font.widthOfTextAtSize(part+character,9)>770){line(part,9);part="";}part+=character;}if(part)line(part,9);};
 line(`STOR24 | ${title}`,20,true);line(period);line(`Generated ${new Date().toISOString()} | Confidential`);const insight=reportInsights(key,rows);
 for(const m of insight.metrics)line(`${m.label}: ${m.money?"R ":""}${m.value.toLocaleString("en-ZA")}`,12,true);
 line(insight.chartTitle,12,true);const max=insight.chartTitle.includes("(%)")?100:Math.max(1,...insight.bars.map(b=>Math.abs(b.value)));for(const b of insight.bars.slice(0,20)){line(`${b.label}: ${b.value.toLocaleString("en-ZA")}`);if(y<50){page=pdf.addPage([842,595]);y=550;}page.drawRectangle({x:35,y:y+5,width:Math.max(1,Math.abs(b.value)/max*400),height:6,color:rgb(1,.32,0)});y-=8;}
 wrap(insight.guidance);line(`Detail: ${rows.length} records`,13,true);const headers=Object.keys(rows[0]??{});
 // Wide operational reports use labelled records, retaining every field rather than clipping columns.
 for(const [i,row] of rows.entries()){line(`Record ${i+1}`,10,true);for(const h of headers)wrap(`${heading(h)}: ${row[h]??"Not recorded"}`);y-=8;}
 const pages=pdf.getPages();for(const [i,p] of pages.entries())p.drawText(`STOR24 | ${i+1} / ${pages.length}`,{x:35,y:20,size:8,font});return pdf.save();
}
