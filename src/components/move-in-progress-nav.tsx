"use client";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
export type MoveInStep = { label: string; status: string; complete: boolean; icon: LucideIcon; blocked?: boolean; href?: string; onClick?: () => void };
export function MoveInProgressNav({ steps }: { steps: MoveInStep[] }) {
  return <nav className="move-in-progress" aria-label="Move-in progress"><ol>{steps.map((step, index) => {
    const Icon = step.icon;
    const content = <><span className="move-in-progress__number"><Icon size={19} aria-hidden="true" />{step.complete && <Check className="move-in-progress__tick" size={11} aria-label="Complete" />}</span><span><strong>{step.label}</strong><small>{step.status}</small></span></>;
    return <li key={step.label} className={step.complete ? "is-complete" : step.blocked ? "is-blocked" : "is-action"}>
      {step.href ? <a href={step.href}>{content}</a> : <button type="button" disabled={!step.onClick} onClick={step.onClick}>{content}</button>}
      {index < steps.length - 1 && <ChevronRight className="move-in-progress__arrow" size={15} aria-hidden="true" />}
    </li>;
  })}</ol></nav>;
}
