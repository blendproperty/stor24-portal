import React from "react";
import { createRoot } from "react-dom/client";
import { CollectionsWorkspace } from "../../src/components/collections-workspace";
createRoot(document.getElementById("root")).render(<main style={{padding:24,maxWidth:1500,margin:"auto"}}><h1>Collections</h1><CollectionsWorkspace/></main>);
