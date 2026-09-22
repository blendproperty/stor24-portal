import React from "react";
import { createRoot } from "react-dom/client";
import { IdentityReview } from "../../src/components/identity-review";
createRoot(document.getElementById("root")).render(<IdentityReview enabled={location.search.includes("enabled")} />);
