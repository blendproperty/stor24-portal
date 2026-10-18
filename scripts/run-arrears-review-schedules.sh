#!/usr/bin/env bash
set -euo pipefail
# The key remains inside the app environment; never put it in process arguments or logs.
exec docker exec stor24-crm-app-1 node -e '
(async () => {
  if (process.env.ARREARS_REVIEW_SCHEDULE_ENABLED !== "true") {
    console.log(JSON.stringify({ disabled: true })); return;
  }
  const key = process.env.ARREARS_REVIEW_WORKER_KEY || "";
  if (key.length < 32) throw Error("INTERNAL_REVIEW_WORKER_KEY_MISSING");
  const response = await fetch("http://127.0.0.1:3000/api/internal/arrears-review-schedules", {
    method: "POST", headers: { authorization: "Bearer " + key }, signal: AbortSignal.timeout(80000)
  });
  if (!response.ok) throw Error("INTERNAL_REVIEW_WORKER_FAILED");
  const { data } = await response.json();
  console.log(JSON.stringify({ disabled: data.disabled, evaluated: data.evaluated, prepared: data.prepared, held: data.held, more: data.more }));
})().catch(() => { console.error("Internal review evaluation needs administrator review."); process.exitCode = 1; });
'
