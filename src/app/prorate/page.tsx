"use client";
import { useState } from "react";
import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { initialRentPreview, type InitialRentPolicy } from "@/lib/proration-preview";
import { southAfricaDateKey } from "@/lib/south-africa-time";
export default function ProratePage() {
  const [rate, setRate] = useState("1850");
  const [date, setDate] = useState(() => southAfricaDateKey(new Date()));
  const [mode,setMode]=useState<InitialRentPolicy['mode']>('ACTUAL_DAYS');
  const [cutoffDay,setCutoff]=useState(15);
  const result = rate.trim() ? initialRentPreview(Number(rate), date,{mode,cutoffDay}) : null;
  const currency = (amount: number) => amount.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
  return <div className="page-stack">
    <PageHeader eyebrow="Utility" title="Prorate calculator" description="Compare actual days, a full month, or remaining days plus next month after the selected cutoff. The move-in day is included." />
    <section className="calculator-card panel">
      <div className="calculator-icon"><Calculator size={28} /></div>
      <label>Monthly rate (ZAR)<input type="number" min="0" max="10000000" step="0.01" value={rate} onChange={event => setRate(event.target.value)} /></label>
      <label>Effective date<input type="date" min="2000-01-01" max="2099-12-31" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="calculator-method">Pricing method<select value={mode} onChange={e=>setMode(e.target.value as InitialRentPolicy['mode'])}><option value="ACTUAL_DAYS">Actual remaining days</option><option value="FULL_MONTH">Full month</option><option value="AFTER_CUTOFF_NEXT_MONTH">Remaining days plus next month after cutoff</option></select></label>
      {mode==='AFTER_CUTOFF_NEXT_MONTH'&&<label>Cutoff day<input type="number" min="1" max="31" value={cutoffDay} onChange={e=>setCutoff(Number(e.target.value))}/></label>}
      <div className="calculation-result" aria-live="polite"><span>Estimated prorated rent</span>{result ? <><strong>{currency(result.total)}</strong>{result.lines.map(line=><small key={line.period}>{line.period}: {currency(line.amount)}</small>)}<small>{result.remaining} of {result.days} days · {currency(result.dailyRate)} per day</small></> : <p>Enter a valid date and a monthly rate from R 0 to R 10,000,000.</p>}</div>
      <p className="calculator-note">Preview only. This does not post a charge. Confirm the agreed billing method, VAT, discounts and other charges on the customer account before applying an amount.</p>
    </section>
  </div>;
}
