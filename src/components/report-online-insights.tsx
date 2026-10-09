"use client";
import { useState } from "react";
import { reportFieldLabel, type ReportDataset, type VisualReportQuery, type VisualReportRow } from "@/lib/visual-report-contract";

export function ReportOnlineInsights({rows,query,dataset,matchedRows}:{rows:VisualReportRow[];query:VisualReportQuery;dataset:ReportDataset;matchedRows:number}) {
  const [search,setSearch]=useState("");
  const [dimension,setDimension]=useState("");
  const keys=query.metrics.length?[...query.groupBy,...query.metrics.map(m=>`${m.operation}_${m.field}`)]:query.columns;
  const dimensions=keys.filter(key=>dataset.fields.some(f=>f.key===key&&["text","boolean"].includes(f.type)&&!f.personal));
  const category=dimensions.includes(dimension)?dimension:dimensions[0];
  const counts=new Map<string,number>();
  if(category)for(const row of rows){const label=row[category]===null?"Not recorded":String(row[category]??"Not recorded");counts.set(label,(counts.get(label)??0)+1);}
  const bars=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,10),maximum=Math.max(1,...bars.map(b=>b[1]));
  const filtered=rows.filter(row=>keys.some(key=>String(row[key]??"").toLowerCase().includes(search.toLowerCase())));
  return <div className="report-online-dashboard">
    <div className="report-online-kpis"><article><span>Matching source records</span><strong>{matchedRows.toLocaleString()}</strong></article><article><span>Result rows</span><strong>{rows.length.toLocaleString()}</strong></article><article><span>Visible after search</span><strong>{filtered.length.toLocaleString()}</strong></article></div>
    {category&&rows.length>0&&<section className="report-online-chart" aria-label="Result row distribution"><div className="panel-heading"><h3>Result row distribution</h3><label>Break down by<select value={category} onChange={e=>setDimension(e.target.value)}>{dimensions.map(key=><option key={key} value={key}>{reportFieldLabel(dataset,key)}</option>)}</select></label></div><p>Counts of result rows, including grouped rows. Top 10 categories; financial totals remain in the report table.</p>{bars.map(([label,count])=><div className="report-online-bar" key={label}><span>{label}</span><meter min={0} max={maximum} value={count}>{count}</meter><strong>{count.toLocaleString()}</strong></div>)}</section>}
    <label>Search result rows<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a value in this report…"/></label>
    <p>Showing the first 100 matching result rows. Downloads contain the complete report selection, without this on-screen search.</p>
    <div className="table-wrap"><table className="data-table"><thead><tr>{keys.map(key=><th key={key}>{reportFieldLabel(dataset,key)}</th>)}</tr></thead><tbody>{filtered.slice(0,100).map((row,index)=><tr key={index}>{keys.map(key=><td key={key}>{row[key]===null?"Not recorded":typeof row[key]==="boolean"?(row[key]?"Yes":"No"):String(row[key]??"")}</td>)}</tr>)}</tbody></table></div>
    {!filtered.length&&<p>No result rows match this search.</p>}
  </div>;
}
