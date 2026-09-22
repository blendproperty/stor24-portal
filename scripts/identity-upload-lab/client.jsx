import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import IdentityStep from "lab-customer";
import { IdentityReview } from "lab-review";

function Lab() {
  const [view, setView] = useState("customer"), [message, setMessage] = useState("");
  async function gates() {
    const response = await fetch("/lab/gates");
    const body = await response.json();
    setMessage(response.ok ? `ID check for signing: ${body.sign ? "passed" : "waiting for upload"}. ID check for handover: ${body.handover ? "passed" : "waiting for staff acceptance"}. This test does not sign an agreement or enable entry.` : "Test session unavailable. Reopen the page.");
  }
  return <>
    <header className="lab-header"><span className="lab-brand">STOR24 <small>TEST WORKSPACE</small></span><h1>Try the identity document step.</h1><p>Use the sample images below, not a real ID. Uploads use the real encrypted storage and review service in a separate local database.</p><p className="lab-note">Test notice only · Live customer collection remains off · Sample copies expire after one hour</p><div className="lab-actions"><a href="/sample-front.png" download="stor24-test-front.png">Download sample front ↓</a><a href="/sample-back.png" download="stor24-test-back.png">Download sample back ↓</a></div></header>
    <nav className="lab-tabs" aria-label="Test views"><button aria-pressed={view === "customer"} onClick={() => { setView("customer"); setMessage(""); }}>1. Customer upload</button><button aria-pressed={view === "staff"} onClick={() => { setView("staff"); setMessage(""); }}>2. Staff review</button><button onClick={gates}>Check progress</button></nav>
    {message && <p className="lab-result" role="status">{message}</p>}
    {view === "customer" ? <IdentityStep reference="ST24-LOCAL-ID-TEST" unit="TEST 01" onContinue={gates} onVerify={() => location.reload()} /> : <IdentityReview enabled />}
    <footer className="lab-footer">This workspace uses a pre-verified invented booking and a test reviewer. Email/WhatsApp verification, real staff sign-in, signing, payment and key handover are outside this test. The workspace closes after four hours; restarting it starts fresh.</footer>
  </>;
}
createRoot(document.getElementById("root")).render(<Lab />);
