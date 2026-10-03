"use client";
import { useState } from "react";
import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prorationPreview } from "@/lib/proration-preview";
import { southAfricaDateKey } from "@/lib/south-africa-time";
export default function ProratePage() {
  const [rate, setRate] = useState("1850");
  const [date, setDate] = useState(() => southAfricaDateKey(new Date()));
  const result = rate.trim() ? prorationPreview(Number(rate), date) : null;
  const currency = (amount: number) => amount.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
  return <div className="page-stack">
    <PageHeader eyebrow="Utility" title="Prorate calculator" description="Estimate rent from the selected date to month-end using actual calendar days. The effective day is included." />
    <section className="calculator-card panel">
      <div className="calculator-icon"><Calculator size={28} /></div>
      <label>Monthly rate (ZAR)<input type="number" min="0" max="10000000" step="0.01" value={rate} onChange={event => setRate(event.target.value)} /></label>
      <label>Effective date<input type="date" min="2000-01-01" max="2099-12-31" value={date} onChange={event => setDate(event.target.value)} /></label>
      <div className="calculation-result" aria-live="polite"><span>Estimated prorated rent</span>{result ? <><strong>{currency(result.amount)}</strong><small>{result.remaining} of {result.days} days · {currency(result.dailyRate)} per day</small></> : <p>Enter a valid date and a monthly rate from R 0 to R 10,000,000.</p>}</div>
      <p className="calculator-note">Preview only. This does not post a charge. Confirm the agreed billing method, VAT, discounts and other charges on the customer account before applying an amount.</p>
    </section>
  </div>;
}
