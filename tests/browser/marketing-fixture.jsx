import React from "react";
import { createRoot } from "react-dom/client";
import { MarketingDashboard } from "../../src/components/marketing-dashboard";
import { AdvertisingConnectionForm } from "../../src/components/advertising-connection-form";
import { MoveInWorkspace } from "../../src/components/move-in-workspace";
const move = location.pathname === "/move-in";
createRoot(document.getElementById("root")).render(
  <div className="app-shell">
    <main className="content">
      {location.pathname === "/settings/advertising" ? <AdvertisingConnectionForm /> : move ? (
        <MoveInWorkspace
          facilities={[{ id: "fixture", name: "Training store" }]}
          customers={[]}
          reservations={[]}
          units={[
            {
              id: "unit",
              facilityId: "fixture",
              number: "12",
              floor: "Ground floor",
              zone: "A",
              status: "AVAILABLE",
              monthlyRate: 1100,
              typeName: "Small",
              width: 2,
              length: 3,
              area: 6,
              features: [],
            },
          ]}
          action={() => {
            throw Error("Unexpected operational action");
          }}
        />
      ) : (
        <MarketingDashboard
          canManage={!location.search.includes("restricted")}
        />
      )}
    </main>
  </div>,
);
