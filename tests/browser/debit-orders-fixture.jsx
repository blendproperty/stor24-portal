import React from "react";
import { createRoot } from "react-dom/client";
import { DebitOrderWorkspace } from "../../src/components/debit-order-workspace";
createRoot(document.getElementById("root")).render(<main style={{ maxWidth:1120, margin:"auto", padding:20 }}><h1>Debit-order runs</h1><DebitOrderWorkspace/></main>);
