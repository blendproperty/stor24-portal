"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ZodType } from "zod";

/** Shared read/recovery behaviour; acknowledgement never retries automatically. */
export function useStaffAttention<T>(url: string, schema: ZodType<{ data: T }>) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const reader = useRef<AbortController | null>(null), writer = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller; setLoading(true); setError("");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (reader.current !== controller) return;
      if ([401, 403].includes(response.status)) { setData(null); throw new Error(response.status === 401 ? "Sign in again to view this queue." : "You do not have access to this queue."); }
      if (!response.ok) throw new Error("The queue could not be loaded. Reload before relying on displayed records.");
      const result = schema.parse(await response.json()).data;
      if (reader.current !== controller) return;
      setData(result); setUncertain(false);
    } catch (e) { if (reader.current === controller) setError(e instanceof Error && !e.message.startsWith("[") ? e.message : "The queue returned incomplete records. Reload before making changes."); }
    finally { clearTimeout(timer); if (reader.current === controller) { reader.current = null; setLoading(false); } }
  }, [url, schema]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => { clearTimeout(timer); reader.current?.abort(); reader.current = null; }; }, [reload]);
  useEffect(() => () => writer.current?.abort(), []);
  async function mutate(endpoint: string, method: "POST" | "PATCH", body: unknown, onSaved?: () => void) {
    if (writer.current || loading || uncertain || error) return;
    const controller = new AbortController(); writer.current = controller; setBusy(true); setError(""); setNotice("");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { method, signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
        if ([401, 403].includes(response.status)) setData(null);
        setError(response.status === 409 ? "The source or handover changed. Reload the current record before confirming again." : "The change was not saved. Reload and check your access and the details."); return;
      }
      const result = await response.json();
      if (!response.ok || typeof result.data?.id !== "string") throw new Error("UNCONFIRMED");
      onSaved?.(); setNotice("Your acknowledgement or handover has been saved."); await reload();
    } catch { setUncertain(true); setError("We could not confirm the save. Reload and check the recorded status before trying again."); }
    finally { clearTimeout(timer); if (writer.current === controller) writer.current = null; setBusy(false); }
  }
  return { data, error, notice, loading, busy, reload, mutate, disabled: loading || busy || uncertain || !!error };
}
