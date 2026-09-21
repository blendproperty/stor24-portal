import React from "react";
import { createRoot } from "react-dom/client";
import { AdjustmentsWorkspace } from "../../src/components/adjustments-workspace";
createRoot(document.getElementById("root")).render(<main style={{maxWidth:1120,margin:"auto",padding:20}}><h1>Adjustments</h1><AdjustmentsWorkspace/></main>);
