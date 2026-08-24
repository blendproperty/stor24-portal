"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BlendSignReconciliationActions({ documentId, action }: { documentId: string; action: "retry-dispatch" | "resend-invitation" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/v1/documents/${encodeURIComponent(documentId)}/actions/${action}`, { method: "POST" });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "The action failed."); return; }
    setMessage(payload.message ?? "Action completed.");
    router.refresh();
  }
  return <span className="reconciliation-action"><button type="button" className="button button-secondary button-small" disabled={busy} onClick={run}>{busy ? "Working…" : action === "retry-dispatch" ? "Retry dispatch" : "Send reminder"}</button>{message ? <small>{message}</small> : null}</span>;
}
