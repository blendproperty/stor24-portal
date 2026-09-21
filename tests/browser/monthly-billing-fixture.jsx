import React from "react";
import { createRoot } from "react-dom/client";
import { MonthlyBillingWorkspace } from "../../src/components/monthly-billing-workspace";
createRoot(document.getElementById("root")).render(<main style={{ maxWidth: 1120, margin: "auto", padding: 20 }}><h1>Monthly billing</h1><MonthlyBillingWorkspace/></main>);
