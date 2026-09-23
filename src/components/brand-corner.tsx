"use client";

import { useEffect, useRef, useState } from "react";
import { PackageOpen, Sparkles, X } from "lucide-react";

const tips: Record<string, [string, string]> = {
  settings: ["Small settings. Big peace of mind.", "A tidy setup gives every store a smoother day."],
  company: ["Good things start with good foundations.", "Keep store details and opening hours as welcoming as your front desk."],
  identity: ["A little check. A lot of peace of mind.", "Give every page a proper look before welcoming someone in."],
  "move-in": ["Make room for a great first impression.", "Find their fit, check the details, then make moving day feel easy."],
  operations: ["Space sorted. Day sorted.", "One clear next step is a good place to start."],
  tenants: ["Behind every box is a person.", "A little care goes a long way. Make their next visit an easy one."],
  reservations: ["Their next chapter needs a little space.", "Keep an eye on hold dates so nobody loses their perfect fit."],
  leads: ["Hello today. Happy storing tomorrow.", "A thoughtful follow-up can make all the difference."],
  units: ["There’s a perfect fit for every story.", "Check dimensions and access needs before recommending a space."],
  billing: ["Keep the numbers as tidy as the aisles.", "Match each payment to the right account before calling it sorted."],
  collections: ["A friendly reminder can go a long way.", "Check the account story before choosing the next follow-up."],
  access: ["Warm welcomes start at the gate.", "Check the actual access status before promising a smooth arrival."],
  merchandise: ["A little tape. A lot less moving-day drama.", "Help customers find the packing essentials that suit their move."],
  insurance: ["A little clarity brings peace of mind.", "Make sure customers understand their selected cover."],
  adjustments: ["Even the details deserve a tidy home.", "A clear reason today makes tomorrow’s account review easier."],
  reports: ["Big picture. Clear head.", "Check the store and dates before sharing the story behind the numbers."],
  graphs: ["Give the numbers a little perspective.", "Compare like-for-like periods for a clearer picture."],
  communications: ["Sound like a person. Make someone’s day.", "A clear, friendly message always has room for a little warmth."],
  integrations: ["Good connections make light work.", "Check the connection status before relying on a handoff."],
  calendar: ["Make a little room in the diary.", "A well-timed reminder makes moving day run more smoothly."],
  prorate: ["Every day has its place.", "Double-check the dates before applying a prorated amount."],
  map: ["A bird’s-eye view. A better welcome.", "Help customers picture their route from the entrance to their unit."],
  phone: ["A warm hello opens doors.", "Have the customer’s next step ready before you wrap up the call."],
  audit: ["Every good story leaves a trail.", "Use dates and filters to find the detail you need."],
  users: ["The right keys for the right people.", "Give teammates the access they need for their role and store."],
  "offline-readiness": ["Ready, even when the signal isn’t.", "Check this device’s readiness before heading away from a connection."],
};

export function BrandCorner({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const segment = pathname.split("/").filter(Boolean).reverse().find(part => tips[part]);
  const [title, copy] = tips[segment ?? ""] ?? ["More room for a good day.", "One task at a time. You’ve got space to make a difference."];
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  return <aside className="brand-corner" aria-label="A little STOR24 inspiration">
    {open && <section id="stor24-corner-tip" className="brand-corner__tip" aria-label="STOR24 tip">
      <button className="brand-corner__close" aria-label="Close STOR24 tip" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button>
      <span className="brand-corner__eyebrow"><Sparkles size={13} /> A LITTLE SPACE FOR GOOD</span>
      <h2>{title}</h2><p>{copy}</p><small>STOR24 · Make room for life.</small>
    </section>}
    <button ref={trigger} className="brand-corner__trigger" aria-expanded={open} aria-controls="stor24-corner-tip" onClick={() => setOpen(value => !value)}><PackageOpen size={20} /><span>A little space for good</span><span className="brand-corner__spark" aria-hidden="true">✦</span></button>
  </aside>;
}
