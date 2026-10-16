import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountsWorkspace } from "../../src/components/accounts-workspace";

// Synthetic display data only. Never delegate to the browser's native fetch.
const accountId = "synthetic-debtor-demo";
let scenario = "partial";
const payments = { unpaid: 0, partial: 400, settled: 1000 };
window.fetch = async (input, options = {}) => {
  if (input !== "/api/v1/accounts" || (options.method || "GET") !== "GET") {
    return Response.json({ error: { message: "Read-only demonstration. No transaction was recorded." } }, { status: 403 });
  }
  const paid = payments[scenario];
  const entries = [{ id: "demo-charge", type: "CHARGE", amount: "1000", description: "Demonstration rental charge", effectiveAt: "2026-10-01T08:00:00+02:00" }];
  if (paid) entries.unshift({ id: "demo-payment", type: "PAYMENT", amount: String(paid), description: "Illustrative payment — no funds received", effectiveAt: "2026-10-15T09:00:00+02:00" });
  return Response.json({ data: { facilities: [], accounts: [{
    id: accountId, accountNumber: "DEMO-FAEEZ-001", balance: String(1000 - paid), currency: "ZAR",
    customer: { firstName: "Test", lastName: "Customer", companyName: null, email: "debtor@example.invalid", phone: null },
    tenancy: { id: "demo-tenancy", status: "ACTIVE", facilityId: "demo-store", facility: { name: "Demonstration store" }, documents: [], occupancies: [{ status: "ACTIVE", monthlyRate: "1000", unit: { number: "DEMO-001", unitType: { name: "Test unit" } } }] },
    ledgerEntries: entries, payments: paid ? [{ id: "demo-receipt", amount: String(paid), method: "EFT", status: "SUCCEEDED", processedAt: "2026-10-15T09:00:00+02:00", createdAt: "2026-10-15T09:00:00+02:00" }] : [],
  }] } });
};

// Links are inert even if a future component introduces another action.
document.addEventListener("click", event => {
  if (event.target.closest("a")) event.preventDefault();
}, true);

function Demo() {
  const [selected, setSelected] = useState(scenario);
  return <main className="demo-container">
    <section className="demo-banner" aria-label="Demonstration controls">
      <strong>TEST CUSTOMER · ISOLATED DEMONSTRATION</strong>
      <p>This is a preview of the STOR24 Accounts screen using invented data. No customer account, money, payment provider, MRI record or gate access is changed. Illustrative payments are not receipts.</p>
      <label htmlFor="demo-scenario">Choose a balance scenario</label>
      <select id="demo-scenario" value={selected} onChange={event => { scenario = event.target.value; setSelected(scenario); }}>
        <option value="unpaid">Unpaid · R1,000 outstanding</option>
        <option value="partial">Part paid · R600 outstanding</option>
        <option value="settled">Settled · R0 outstanding</option>
      </select>
      <p><strong>R1,000 charged − R{payments[selected].toLocaleString("en-ZA")} illustrative payment = R{(1000 - payments[selected]).toLocaleString("en-ZA")} outstanding</strong></p>
      <p>Account: DEMO-FAEEZ-001 · Test Customer · Unit DEMO-001 · 16 October 2026</p>
    </section>
    <AccountsWorkspace key={selected} initialAccountId={accountId}/>
  </main>;
}
createRoot(document.getElementById("root")).render(<Demo/>);
