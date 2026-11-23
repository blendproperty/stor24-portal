import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { maintenanceJobActionAllowed, type midpointMaintenanceRole } from "@/lib/maintenance-job-policy";
import type { maintenanceJobActionSchema } from "@/lib/validators";
import type { z } from "zod";

export type JobCardAction = z.infer<typeof maintenanceJobActionSchema>;
export type MaintenanceJob = {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  status: string;
  updatedAt: string;
  dueAt?: string | null;
  unit?: { number: string } | null;
  assignedTo?: { name: string } | null;
  contractor?: string | null;
  scheduledFor?: string | null;
  progressNotes?: string | null;
  completionEvidence?: string | null;
  repairReportedAt?: string | null;
  verificationNote?: string | null;
};

const statuses = { OPEN: "Open", SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", BLOCKED: "Blocked" } as const;

export function MaintenanceJobCard({ job, role, disabled, update }: {
  job: MaintenanceJob;
  role: ReturnType<typeof midpointMaintenanceRole>;
  disabled: boolean;
  update: (id: string, action: JobCardAction) => void;
}) {
  const { updatedAt } = job;
  const manage = maintenanceJobActionAllowed(role, job.status, !!job.repairReportedAt, "manage");
  const verify = maintenanceJobActionAllowed(role, job.status, !!job.repairReportedAt, "verify");
  const cancel = maintenanceJobActionAllowed(role, job.status, !!job.repairReportedAt, "cancel");
  const scheduleInput = job.scheduledFor ? new Date(Date.parse(job.scheduledFor) + 7_200_000).toISOString().slice(0, 16) : "";
  const status = job.status === "COMPLETED" ? "Verified" : job.repairReportedAt ? "Awaiting Katlego’s verification" : statuses[job.status as keyof typeof statuses] ?? job.status;

  return <details className="panel panel-spacious">
    <summary><strong>{job.title}</strong> · {status} · {job.priority.toLowerCase()} priority</summary>
    <p>{job.unit ? `Unit ${job.unit.number}` : "Midpoint facility"} · {job.assignedTo?.name ?? "Waiting for Carlo’s portal access"}</p>
    {job.description && <p>{job.description}</p>}
    {job.dueAt && <p>Due {formatSouthAfricaDateTime(job.dueAt)}</p>}
    {job.contractor && <p>Contractor: {job.contractor}</p>}
    {job.scheduledFor && <p>Scheduled: {formatSouthAfricaDateTime(job.scheduledFor)} SAST</p>}
    {job.progressNotes && <p>Progress: {job.progressNotes}</p>}
    {job.completionEvidence && <p>Completion evidence: {job.completionEvidence}</p>}
    {job.verificationNote && <p>Katlego’s inspection notes: {job.verificationNote}</p>}
    {manage && <>
      <form key={updatedAt} className="invite-form" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const scheduledFor = String(form.get("scheduledFor") ?? "");
        update(job.id, {
          action: "manage", updatedAt, status: form.get("status") as keyof typeof statuses,
          contractor: String(form.get("contractor") ?? ""), progressNotes: String(form.get("progressNotes") ?? ""),
          scheduledFor: scheduledFor ? new Date(`${scheduledFor}+02:00`).toISOString() : null,
        });
      }}>
        <label>Status<select name="status" defaultValue={job.status}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Contractor<input name="contractor" maxLength={200} defaultValue={job.contractor ?? ""} /></label>
        <label>Scheduled time (SAST)<input name="scheduledFor" type="datetime-local" defaultValue={scheduleInput} /></label>
        <label>Progress notes<textarea name="progressNotes" maxLength={4000} defaultValue={job.progressNotes ?? ""} /></label>
        <button className="button button-secondary" disabled={disabled}>Save progress</button>
      </form>
      <form className="invite-form" onSubmit={event => {
        event.preventDefault();
        update(job.id, { action: "report", updatedAt, evidence: String(new FormData(event.currentTarget).get("evidence") ?? "") });
      }}>
        <label>Completion evidence<textarea name="evidence" minLength={2} maxLength={4000} required defaultValue={job.completionEvidence ?? ""} /></label>
        <small>Describe the repair and include the work order or photo report reference, if available.</small>
        <button className="button button-primary" disabled={disabled}>Send for on-site verification</button>
      </form>
    </>}
    {(verify || cancel) && <form className="invite-form" onSubmit={event => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const action = cancel ? "cancel" : submitter?.getAttribute("value") === "return" ? "return" : "verify";
      update(job.id, { action, updatedAt, note: String(new FormData(event.currentTarget).get("note") ?? "") });
    }}>
      <label>{cancel ? "Reason for cancellation" : "On-site inspection notes"}<textarea name="note" minLength={2} maxLength={4000} required /></label>
      <span className="inline-actions">
        {cancel ? <button className="button button-secondary" disabled={disabled}>Cancel job card</button> : <>
          <button className="button button-primary" value="verify" disabled={disabled}>Verify repair and close</button>
          <button className="button button-secondary" value="return" disabled={disabled}>Return to Carlo</button>
        </>}
      </span>
    </form>}
  </details>;
}
