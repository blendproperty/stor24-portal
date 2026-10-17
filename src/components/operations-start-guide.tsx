"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { operationsStartGroups, type OperationsGuideLink } from "@/lib/operations-start-guide";

export function OperationsStartGuide({ links }: { links: OperationsGuideLink[] }) {
  const groups = operationsStartGroups(links);
  const [groupId, setGroupId] = useState("");
  const [jobId, setJobId] = useState("");
  const group = groups.find(item => item.id === groupId) ?? groups[0];
  const selected = group?.jobs.find(item => item.id === jobId);
  if (!group) return null;
  return <section className="panel panel-spacious operations-start-guide" aria-label="Operations start guide">
    <div className="panel-heading"><div><p className="eyebrow">Start here</p><h2>What do you need to do?</h2><p className="panel-subtitle">Choose the job, review the steps, then open the workspace to do it.</p></div><Compass size={25} aria-hidden="true"/></div>
    <div className="operations-start-choices" role="group" aria-label="Choose the type of work">{groups.map(item => <button type="button" key={item.id} aria-pressed={item.id === group.id} onClick={() => { setGroupId(item.id); setJobId(""); }}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div>
    <label className="operations-start-select">Choose a workflow<select aria-label="Choose a workflow" value={selected?.id ?? ""} onChange={event => setJobId(event.target.value)}><option value="">Select what you want to do</option>{group.jobs.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
    {selected ? <div className="operations-start-plan"><h3>{selected.label}</h3><ol>{selected.steps.map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span><p>{step}</p></li>)}</ol><Link className="button button-primary" href={selected.href}>Open workspace <ArrowRight size={16} aria-hidden="true"/></Link><p className="operations-start-footnote">Use Guide me in the workspace for help with its fields.</p></div> : <p className="operations-start-prompt">Your steps and workspace link will appear here when you choose a workflow.</p>}
  </section>;
}
