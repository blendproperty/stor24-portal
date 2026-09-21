import React from "react";
import { createRoot } from "react-dom/client";
import { MriWorkspace } from "../../src/components/mri-workspace";
createRoot(document.getElementById("root")).render(<main style={{padding:20,maxWidth:1240,margin:"auto"}}><MriWorkspace /></main>);
