import React from "react";
import { createRoot } from "react-dom/client";
import { AdditionalAccessPeople } from "../../src/components/additional-access-people";
import { AdditionalAccessQueue } from "../../src/components/additional-access-queue";

const params = new URLSearchParams(location.search);
const person = { id: "synthetic", name: "Example Person", status: "WAITING_REVIEW", photoVersion: 1, expiresAt: "2099-01-01T00:00:00Z", facilityId: "store", facilityName: "Example Store", unitNumber: "101" };
const nominee = { ...person, id: "synthetic-two", status: "NOMINATED", photoVersion: 0 };
const policy = { hash: "synthetic-policy", notice: "Synthetic test policy, not a real notice or consent.", consentLabel: "Synthetic test consent", retentionHours: 24 };
createRoot(document.getElementById("root")).render(params.has("tenant")
  ? <AdditionalAccessPeople reservationId="synthetic-booking" />
  : <AdditionalAccessQueue people={[person, nominee]} policy={params.has("policy") ? policy : null} manageableFacilities={params.has("readonly") ? [] : null} />);
