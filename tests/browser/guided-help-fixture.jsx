// Isolated component fixture. All customers and reservations here are invented.
import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../src/components/app-shell";
import { ReservationsWorkspace } from "../../src/components/reservations-workspace";
import { MoveInWorkspace } from "../../src/components/move-in-workspace";
import { OperationsWorkspace } from "../../src/components/operations-workspace";
import SettingsPage from "../../src/app/settings/page";
import { usePathname } from "next/navigation";

const readiness = { mandateStatus: null, signed: true, leaseId: "fixture-document", signedAt: "2026-09-21", requiredAmount: 1200, paidAmount: 0, paymentVerified: false, testPayment: true, startDate: "2026-09-30", ready: false, blockers: ["A test payment is recorded. It does not clear the real booking for key collection."] };
function Fixture() {
  const path = usePathname();
  const params = new URLSearchParams(window.location.search);
  const user = params.get("user") || "fixture-staff-a";
  return <AppShell session={{ userId: user, name: "Training Preview", email: "fixture@example.invalid", role: "Organisation owner", sessionVersion: 1 }}>
    {params.has("merchandise") ? <OperationsWorkspace view="merchandise" /> : path === "/settings" ? <SettingsPage /> : path === "/reservations" ? <ReservationsWorkspace /> : path === "/operations/move-in" ? <MoveInWorkspace
      key={params.toString()}
      action={async () => { throw new Error("Fixture must not submit a move-in"); }}
      initialReservationId={params.get("reservation") || undefined}
      facilities={[{ id: "fixture-store", name: "Training store" }]}
      units={params.has("inventory") ? Array.from({length:530}, (_,i) => ({id:`unit-${i+1}`,facilityId:"fixture-store",number:String(i+1),floor:i<200?"Ground":"First floor",zone:"",status:"AVAILABLE",monthlyRate:1200,typeName:"B2",width:2,length:3,area:6,features:[]})) : [{ id: "fixture-unit", facilityId: "fixture-store", number: "T01", floor: "Ground", zone: "A", status: "RESERVED", monthlyRate: 1200, typeName: "Training unit", width: 3, length: 3, area: 9, features: [] }]}
      customers={[{ id: "fixture-customer", name: "Example Customer", email: "fixture@example.invalid" }]}
      reservations={[{ id: "fixture-reservation", facilityId: "fixture-store", customerId: "fixture-customer", unitId: "fixture-unit", label: "T01 · Example Customer", paymentMethod: "CARD", intendedMoveIn: "2026-09-30", quotedRate: 1200, readiness: params.has("unsigned") ? null : readiness, canRecordPayment: true }]}
    /> : <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Operations centre · Isolated preview</p><h1>Stor24 operational overview</h1><p>Invented data for browser verification. No customer records are connected.</p></div></header>
      <section className="metric-grid" data-guide="dashboard-metrics">{["Physical occupancy", "Occupied units", "Receivables", "Active leads"].map((label, i) => <article className="panel panel-spacious" key={label}><small>{label}</small><h2>{["64%", "128", "R 12,400", "8"][i]}</h2></article>)}</section>
      <section className="dashboard-grid"><article className="panel panel-spacious" data-guide="dashboard-queue"><h2>Priority work queue</h2><p>Reservations needing attention</p><p>Operational tasks due</p><p>Lead follow-ups due</p></article><article className="panel panel-spacious" data-guide="dashboard-activity"><h2>Recent operational activity</h2><p>Training store · Example reservation created</p></article></section>
    </div>}
  </AppShell>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
