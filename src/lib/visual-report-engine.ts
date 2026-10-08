import { visualReportDatasets, visualReportSchema, type ReportField, type VisualReportQuery, type VisualReportRow } from "./visual-report-contract";

export const REPORT_SOURCE_LIMIT = 5000;
export class ReportError extends Error {}
function cents(value: unknown): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new ReportError("INVALID_REPORT_AMOUNT");
  return (match[1] ? -BigInt(1) : BigInt(1)) * (BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").padEnd(2, "0")));
}
function decimal(value: bigint): string { const abs = value < BigInt(0) ? -value : value; return `${value < BigInt(0) ? "-" : ""}${abs / BigInt(100)}.${String(abs % BigInt(100)).padStart(2, "0")}`; }
const empty = (v: unknown) => v === null || v === undefined || v === "";
function dateOnly(v: unknown) {
  if (empty(v)) return null;
  const value = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(new Date(value).getTime() + 7200000).toISOString().slice(0,10);
}
function compare(a: unknown, b: unknown, field?: ReportField): number {
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if (field?.type === "money") { const av=cents(a), bv=cents(b); return av < bv ? -1 : av > bv ? 1 : 0; }
  if (field?.type === "number") return Number(a) - Number(b);
  if (field?.type === "date") return String(dateOnly(a)).localeCompare(String(dateOnly(b)));
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}
export function evaluateVisualReport(input: unknown, source: VisualReportRow[]) {
  const query = visualReportSchema.parse(input);
  if (source.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
  const dataset = visualReportDatasets.find(d => d.key === query.dataset)!;
  const fields = new Map(dataset.fields.map(f=>[f.key,f]));
  const matched = source.filter(row => {
    if(query.intervalMode) {
      if(empty(row.start))return false;
      const start=String(row.start),end=empty(row.end)?null:String(row.end);
      const periodStart=new Date(`${query.from}T00:00:00+02:00`).getTime(),periodEnd=new Date(`${query.to}T00:00:00+02:00`).getTime()+86400000;
      const startAt=new Date(/^\d{4}-\d{2}-\d{2}$/.test(start)?`${start}T00:00:00+02:00`:start).getTime();
      const endAt=end===null?Infinity:new Date(/^\d{4}-\d{2}-\d{2}$/.test(end)?`${end}T00:00:00+02:00`:end).getTime();
      if(query.intervalMode==="whole-period"?startAt>periodStart||endAt<periodEnd:startAt>=periodEnd||endAt<=periodStart)return false;
    }
    if (query.dateField) { const day = dateOnly(row[query.dateField]); if (!day || day < query.from || day > query.to) return false; }
    return query.filters.every(filter => {
      const a = row[filter.field], b = filter.value;
      if (filter.operator === "isEmpty") return empty(a);
      if (filter.operator === "isNotEmpty") return !empty(a);
      if (empty(a)) return false;
      if (filter.operator === "contains") return String(a).toLocaleLowerCase("en").includes(String(b).toLocaleLowerCase("en"));
      const n = compare(a,b,fields.get(filter.field));
      return ({ eq:n===0, ne:n!==0, gt:n>0, gte:n>=0, lt:n<0, lte:n<=0 } as Record<string,boolean>)[filter.operator];
    });
  });
  let rows: VisualReportRow[];
  if (query.metrics.length) {
    const groups = new Map<string, VisualReportRow[]>();
    for (const row of matched) {
      const key = JSON.stringify(query.groupBy.map(f=>row[f] ?? null));
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key)!.push(row);
    }
    if (!matched.length && !query.groupBy.length) groups.set("[]", []);
    rows = [...groups.values()].map(group => {
      const output: VisualReportRow = Object.fromEntries(query.groupBy.map(f=>[f,group[0]?.[f] ?? null]));
      for (const metric of query.metrics) {
        const key = `${metric.operation}_${metric.field}`;
        if (metric.operation === "count") { output[key] = group.length; continue; }
        const values = group.map(r=>r[metric.field]).filter(v=>!empty(v));
        if (!values.length) { output[key] = null; continue; }
        if (fields.get(metric.field)?.type === "money") {
          const numbers=values.map(cents);
          const sum=numbers.reduce((a,b)=>a+b,BigInt(0));
          let total = metric.operation === "min" ? numbers.reduce((a,b)=>a<b?a:b) : metric.operation === "max" ? numbers.reduce((a,b)=>a>b?a:b) : sum;
          if (metric.operation === "average") { const divisor=BigInt(numbers.length); total = (sum + (sum < BigInt(0) ? -BigInt(1) : BigInt(1))*(divisor/BigInt(2)))/divisor; }
          output[key]=decimal(total);
        } else {
          const valuesN=values.map(Number); const sum=valuesN.reduce((a,b)=>a+b,0);
          if (!Number.isFinite(sum)) throw new ReportError("INVALID_REPORT_AMOUNT");
          output[key]=metric.operation==="min"?Math.min(...valuesN):metric.operation==="max"?Math.max(...valuesN):metric.operation==="average"?sum/valuesN.length:sum;
        }
      }
      return output;
    });
  } else rows = matched.map(row=>Object.fromEntries(query.columns.map(f=>[f,row[f] ?? null])));
  if (query.sort) {
    const { field,direction }=query.sort;
    const metric = query.metrics.find(m=>`${m.operation}_${m.field}`===field);
    const descriptor=metric?.operation==="count"?{key:field,label:field,type:"number" as const}:fields.get(metric?.field ?? field);
    rows.sort((a,b)=> (direction==="asc"?1:-1)*compare(a[field],b[field],descriptor));
  }
  return { rows, matchedRows: matched.length, sourceRows: source.length, query, dataset };
}

export function reportPeriod(cadence: "daily" | "weekly" | "monthly", now: Date) {
  const sast=new Date(now.getTime()+7200000); const day=new Date(Date.UTC(sast.getUTCFullYear(),sast.getUTCMonth(),sast.getUTCDate()));
  const end=new Date(day.getTime()-86400000);
  const start=cadence==="monthly"?new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()-1,1)):new Date(day.getTime()-(cadence==="weekly"?7:1)*86400000);
  const to=cadence==="monthly"?new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),0)):end;
  return {from:start.toISOString().slice(0,10),to:to.toISOString().slice(0,10)};
}
export function nextReportRun(cadence: "daily" | "weekly" | "monthly", now: Date) {
  const sast=new Date(now.getTime()+7200000);
  let next=new Date(Date.UTC(sast.getUTCFullYear(),sast.getUTCMonth(),sast.getUTCDate(),6)); // 08:00 SAST
  if (cadence==="monthly") next=new Date(Date.UTC(sast.getUTCFullYear(),sast.getUTCMonth(),1,6));
  if (cadence==="weekly") next=new Date(next.getTime()+((8-sast.getUTCDay())%7)*86400000); // Monday
  if (next<=now) next=cadence==="monthly"?new Date(Date.UTC(sast.getUTCFullYear(),sast.getUTCMonth()+1,1,6)):new Date(next.getTime()+(cadence==="weekly"?7:1)*86400000);
  return next;
}
export function defaultVisualQuery(datasetKey: string, from: string, to: string): VisualReportQuery {
  const dataset=visualReportDatasets.find(d=>d.key===datasetKey)!;
  return {version:1,name:dataset.name,dataset:dataset.key,columns:dataset.fields.slice(0,8).map(f=>f.key),filters:[],groupBy:[],metrics:[],from,to,...(dataset.fields.some(f=>f.key==="date")?{dateField:"date"}:{})};
}
