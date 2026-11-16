"use client";

import { useEffect, useRef, useState } from "react";
import { MaintenanceJobCard, type JobCardAction, type MaintenanceJob } from "@/components/maintenance-job-card";
import { PageHeader } from "@/components/page-header";
import { MIDPOINT_JOB_CARD_API } from "@/lib/maintenance-job-policy";

export function MidpointJobCards() {
  const [jobs, setJobs] = useState<MaintenanceJob[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(MIDPOINT_JOB_CARD_API, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error();
        setJobs(payload.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Could not load Midpoint job cards. Check your access and reload.");
      });
    return () => controller.abort();
  }, []);

  async function update(id: string, action: JobCardAction) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/operations/maintenance/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json();
      if (!response.ok && response.status < 500 && response.status !== 409) {
        setMessage(payload.error?.message ?? "The job card could not be updated.");
        return;
      }
      if (!response.ok || payload.data?.id !== id || !payload.data.updatedAt) throw new Error();
      setJobs(current => current?.map(job => job.id === id
        ? { ...job, ...payload.data, unit: job.unit, assignedTo: { name: "Carlo Viviers" } }
        : job) ?? null);
      setMessage("Job card saved.");
    } catch {
      setJobs(null);
      setMessage("Reload the job cards and check the saved status before trying again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <PageHeader eyebrow="Store 1 - Midpoint" title="Midpoint job cards" description="Schedule repairs, record progress and send completed work to Katlego for on-site verification." />
    {message && <p role="status">{message}</p>}
    <div className="work-list">
      {jobs === null && !message && <p>Loading job cards…</p>}
      {jobs?.length === 0 && <p>No Midpoint job cards yet.</p>}
      {jobs?.map(job => <MaintenanceJobCard key={job.id} job={job} role="manager" disabled={busy} update={update} />)}
    </div>
  </>;
}
