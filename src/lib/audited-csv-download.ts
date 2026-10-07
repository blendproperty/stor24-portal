/** Download only the bytes authorised and audited by the server. */
export async function auditedCsvDownload(input: { kind: "marketing" | "advertising" | "rent-review"; rows: (string | number)[][]; filename: string; facilityId?: string; from?: string; to?: string }) {
  const response = await fetch("/api/v1/reports/csv", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.code === "PERSONAL_EXPORT_FORBIDDEN" ? "Personal-data exports require Super Admin (Organisation owner) authorisation." : "This export could not be authorised. Check your access or contact a Super Admin.");
  }
  if (!(response.headers.get("content-type") ?? "").startsWith("text/csv")) throw new Error("The export response was invalid.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  try { link.href = url; link.download = input.filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
