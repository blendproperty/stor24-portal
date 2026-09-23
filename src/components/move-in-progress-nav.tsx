"use client";
import { Check, ChevronRight } from "lucide-react";
export type MoveInStep = { label: string; status: string; complete: boolean; href?: string; onClick?: () => void };
export function MoveInProgressNav({ steps }: { steps: MoveInStep[] }) {
  return <nav className="move-in-progress" aria-label="Move-in progress"><ol>{steps.map((step, index) => <li key={step.label} className={step.complete ? "is-complete" : ""}>
    {step.href ? <a href={step.href}><span className="move-in-progress__number">{step.complete ? <Check size={17} aria-label="Complete" /> : index + 1}</span><span><strong>{step.label}</strong><small>{step.status}</small></span></a> : <button type="button" disabled={!step.onClick} onClick={step.onClick}><span className="move-in-progress__number">{step.complete ? <Check size={17} aria-label="Complete" /> : index + 1}</span><span><strong>{step.label}</strong><small>{step.status}</small></span></button>}
    {index < steps.length - 1 && <ChevronRight className="move-in-progress__arrow" size={15} aria-hidden="true" />}
  </li>)}</ol></nav>;
}
