"use client";

import { useState } from "react";

const titles = [
  "Prospect follow-up", "Viewing appointment", "Move-in follow-up", "Customer call",
  "Document follow-up", "Payment follow-up", "Move-out follow-up", "Staff handover",
];
const other = "__other";

/** Keep the existing title string contract, including previously saved custom titles. */
export function AppointmentTitleField({ initialTitle = "", disabled = false }: { initialTitle?: string; disabled?: boolean }) {
  const [choice, setChoice] = useState(() => titles.includes(initialTitle) ? initialTitle : initialTitle ? other : "");
  const [custom, setCustom] = useState(() => titles.includes(initialTitle) ? "" : initialTitle);
  return <div className="page-stack">
    <label>Appointment title<select value={choice} required disabled={disabled} onChange={event => setChoice(event.target.value)}>
      <option value="">Choose appointment title</option>
      {titles.map(title => <option key={title} value={title}>{title}</option>)}
      <option value={other}>Other</option>
    </select></label>
    {choice === other ? <label>Other appointment title<input value={custom} onChange={event => setCustom(event.target.value)} minLength={2} maxLength={160} required disabled={disabled} placeholder="Describe the appointment"/></label> : null}
    <input type="hidden" name="title" value={choice === other ? custom : choice} disabled={disabled}/>
  </div>;
}
