"use client";
import { useState } from "react";

export function WhatsAppRetryButton({ logId }: { logId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function retry() {
    setState("busy");
    const response = await fetch("/api/v1/communications/retry-whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logId }) });
    setState(response.ok ? "done" : "error");
  }
  return <button className="text-button" type="button" disabled={state === "busy" || state === "done"} onClick={retry}>{state === "busy" ? "Retrying…" : state === "done" ? "Retry queued" : state === "error" ? "Retry failed" : "Retry"}</button>;
}
