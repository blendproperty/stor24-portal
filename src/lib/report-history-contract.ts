import { z } from "zod";
import { inspectReportExport,DLP_MAX_BYTES } from "./dlp-policy";
import { visualReportDatasets,type VisualReportRow } from "./visual-report-contract";
export const historyImportSchema=z.object({kind:z.enum(["validate","import"]),dataset:z.string().max(40),facilityId:z.string().min(1).max(100),name:z.string().trim().min(1).max(100),extractedAt:z.iso.datetime({offset:true}),approvalReference:z.string().trim().min(5).max(150),csv:z.string().max(DLP_MAX_BYTES),mapping:z.record(z.string().max(50),z.string().min(1).max(100))}).strict();
export type HistoryImportInput=z.infer<typeof historyImportSchema>;
export function reportCsvRows(source:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],value="",quoted=false,closedQuote=false;
  source=source.replace(/^\uFEFF/,"");
  for(let index=0;index<source.length;index++) {
    const char=source[index];
    if(char==='"'&&quoted&&source[index+1]==='"'){value+='"';index++;}
    else if(char==='"'){if(quoted){quoted=false;closedQuote=true;}else if(!value&&!closedQuote)quoted=true;else throw new Error("REPORT_CSV_INVALID");}
    else if(char===","&&!quoted){row.push(value);value="";closedQuote=false;}
    else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&source[index+1]==="\n")index++;row.push(value);value="";closedQuote=false;if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>5001)throw new Error("REPORT_LIMIT");}
    else{if(closedQuote)throw new Error("REPORT_CSV_INVALID");value+=char;}
  }
  if(quoted)throw new Error("REPORT_CSV_INVALID");if(value||row.length){row.push(value);if(row.some(v=>v.trim()))rows.push(row);}
  return rows;
}
/** Maps explicit source columns to approved fields; never stores the untouched CSV. */
export function prepareReportHistory(input:HistoryImportInput,facilityName:string) {
  const dataset=visualReportDatasets.find(d=>d.key===input.dataset);if(!dataset)throw new Error("REPORT_DATASET_UNAVAILABLE");
  const parsed=reportCsvRows(input.csv),headers=parsed[0]?.map(h=>h.trim())??[];
  if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error("REPORT_CSV_INVALID");
  if(!input.mapping.sourceRecordId||!headers.includes(input.mapping.sourceRecordId))throw new Error("REPORT_HISTORY_MAPPING");
  const allowed=new Set([...dataset.fields.map(f=>f.key),"sourceRecordId"]);
  if(Object.entries(input.mapping).some(([key,header])=>!allowed.has(key)||!headers.includes(header)))throw new Error("REPORT_HISTORY_MAPPING");
  if(dataset.fields.some(f=>f.type==="money")&&!input.mapping.currency)throw new Error("REPORT_HISTORY_CURRENCY");
  const seen=new Set<string>();const rows:VisualReportRow[]=parsed.slice(1).map(cells=>{
    if(cells.length!==headers.length)throw new Error("REPORT_CSV_INVALID");
    const source=Object.fromEntries(headers.map((h,i)=>[h,cells[i].trim()]));const sourceRecordId=source[input.mapping.sourceRecordId];
    if(!sourceRecordId||seen.has(sourceRecordId))throw new Error("REPORT_HISTORY_DUPLICATE");seen.add(sourceRecordId);
    const row:VisualReportRow={};
    for(const field of dataset.fields) {
      const value=field.key==="facility"?facilityName:input.mapping[field.key]?source[input.mapping[field.key]]:"";
      if(!value){row[field.key]=null;continue;}
      if(value.length>2000)throw new Error("REPORT_HISTORY_FIELD");
      if(field.type==="money"){if(!/^-?\d{1,14}(?:\.\d{1,2})?$/.test(value))throw new Error("REPORT_HISTORY_FIELD");const [whole,fraction=""]=value.split(".");row[field.key]=`${whole}.${fraction.padEnd(2,"0")}`;}
      else if(field.type==="number"){if(!/^-?\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Math.abs(Number(value))>Number.MAX_SAFE_INTEGER)throw new Error("REPORT_HISTORY_FIELD");row[field.key]=Number(value);}
      else if(field.type==="date"){if(!z.iso.date().safeParse(value).success&&!z.iso.datetime({offset:true}).safeParse(value).success)throw new Error("REPORT_HISTORY_FIELD");row[field.key]=value;}
      else if(field.type==="boolean"){if(!["true","false","yes","no","1","0"].includes(value.toLowerCase()))throw new Error("REPORT_HISTORY_FIELD");row[field.key]=["true","yes","1"].includes(value.toLowerCase());}
      else {if(field.key==="currency"&&!/^[A-Z]{3}$/.test(value))throw new Error("REPORT_HISTORY_CURRENCY");row[field.key]=value;}
    }
    if(dataset.fields.some(f=>f.type==="money")&&typeof row.currency!=="string")throw new Error("REPORT_HISTORY_CURRENCY");
    return row;
  });
  if(!rows.length||rows.length>5000)throw new Error("REPORT_LIMIT");
  if(!inspectReportExport("visual-report",rows).allowed)throw new Error("DLP_EXPORT_BLOCKED");
  return {rows,mappedFields:Object.keys(input.mapping).filter(k=>k!=="sourceRecordId"),unmappedFields:dataset.fields.filter(f=>f.key!=="facility"&&!input.mapping[f.key]).map(f=>f.key)};
}
