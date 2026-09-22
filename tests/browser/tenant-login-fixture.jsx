import React from "react";
import { createRoot } from "react-dom/client";
import { TenantPortal } from "../../src/components/tenant-portal";
createRoot(document.getElementById("root")).render(<React.StrictMode><TenantPortal organisation="synthetic" initialBooking="ST24-PREVIEW" /></React.StrictMode>);
