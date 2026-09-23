import React from "react";
import { createRoot } from "react-dom/client";
import { ReservationMoveInConfirmation } from "../../src/components/reservation-move-in-confirmation";
const mode = new URLSearchParams(location.search).get("mode");
const complete = mode === "complete", paid = complete || mode === "reviewed";
const progress = { identityStatus: paid ? "ACCEPTED" : "AWAITING_REVIEW", identityAccepted: paid, identityRequired: true, photoStatus: paid ? "APPROVED" : "NOT_CAPTURED", photoReviewed: paid, photoCollectionEnabled: mode !== "held", handedOver: complete, handedOverAt: complete ? "2026-09-23T09:00:00Z" : null, publicReference: "ST24-SYNTHETIC" };
const readiness = { mandateStatus: null, signed: true, leaseId: "fixture", signedAt: "2026-09-23", requiredAmount: 2199, paidAmount: paid ? 2199 : 0, paymentVerified: paid, testPayment: !paid, startDate: "2026-09-30", ready: false, blockers: ["Key collection starts on 2026-09-30."] };
createRoot(document.getElementById("root")).render(<main className="app-shell"><ReservationMoveInConfirmation reservationId="booking-55" customerName="Synthetic Customer" unitNumber="55" readiness={readiness} progress={progress} canRecordPayment canReviewIdentity canReviewPhoto onBack={() => { location.hash = "select-unit"; }} /></main>);
