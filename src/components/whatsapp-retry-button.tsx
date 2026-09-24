"use client";
import { useState } from "react";

export function WhatsAppRetryButton({ logId }: { logId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function retry() {
    setState("busy"); setMessage("");
    try {
      const response = await fetch("/api/v1/communications/retry-whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logId }) });
      const body = await response.json();
      if (!response.ok || body.data?.ok !== true) {
        setState("error");
        setMessage(typeof body.error === "string" ? body.error : body.error?.message || "The retry was not confirmed. Review this message before sending again.");
        return;
      }
      setState("done");
    } catch {
      setState("error"); setMessage("Confirmation was lost. Retry this same message to check its existing attempt.");
    }
  }
  return <div><button className="text-button" type="button" disabled={state === "busy" || state === "done"} onClick={retry}>{state === "busy" ? "Retrying…" : state === "done" ? "Retry queued" : state === "error" ? "Check retry" : "Retry"}</button>{message && <p role="alert">{message}</p>}</div>;
}
