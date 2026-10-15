"use client";

import { useEffect, useRef, useState } from "react";

export function StaffHandbookDownload() {
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function download() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError("");
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("/api/v1/operations/staff-guide", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) throw Error("Sign in again to download the staff handbook.");
        if (response.status === 403) throw Error("Your account cannot download the staff handbook.");
        let message = "The staff handbook could not be downloaded. Try again.";
        try { message = (await response.json()).error?.message || message; } catch {}
        throw Error(message);
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw Error("The staff handbook was not a valid PDF. Try again.");
      const blob = await response.blob();
      if (!blob.size || await blob.slice(0, 5).text() !== "%PDF-") throw Error("The staff handbook was not a valid PDF. Try again.");
      if (request.current !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "STOR24-staff-handbook-2026-10-15.pdf"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (request.current === controller) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "The handbook download timed out. Try again.");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return <span><button type="button" className="button button-secondary" disabled={busy} onClick={() => void download()}>{busy ? "Preparing handbook…" : "Staff handbook PDF"}</button>{error && <span role="alert" className="form-error">{error}</span>}</span>;
}
