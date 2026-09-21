import React from "react";
import { createRoot } from "react-dom/client";
import { SettlementWorkspace } from "../../src/components/settlement-workspace";
createRoot(document.getElementById("root")).render(<main style={{padding:24,maxWidth:1500,margin:"auto"}}><h1>Settlement reconciliation</h1><SettlementWorkspace/></main>);
