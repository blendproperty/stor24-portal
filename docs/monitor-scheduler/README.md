# Independent monitor trigger

`scripts/external-monitor-worker.mjs` dispatches only the existing STOR24 production monitor on `main`, with test alerts disabled. `wrangler.monitor.json` schedules it at minutes 03/13/23/33/43/53 UTC each hour. GitHub still performs the checks, alerts and dashboard transfer. There is no public HTTP handler, route, workers.dev or preview URL.

## Credential approval and configuration

Before creating access, obtain owner confirmation for a fine-grained GitHub token restricted to **blendproperty/stor24-portal**, **Actions: write**, automatic read-only metadata, and a 90-day expiry. Actions write can manage repository Actions beyond dispatching this workflow; GitHub has no dispatch-only token permission. Store it only as the existing Cloudflare account's encrypted Worker secret `GITHUB_MONITOR_TOKEN`, never in Git, chat, screenshots, configuration or logs. Record the expiry and renewal gate without the credential. Do not upgrade plans or alter spending limits.

Deploy only the reviewed, checked source. Configure the secret before activating the cron. With an authorised local Cloudflare session, Wrangler supports `npx wrangler deploy --config wrangler.monitor.json`; use the Cloudflare dashboard for secret entry and inspect the resulting settings. Keep public URLs disabled. A successful local bundle is not provider deployment proof.

cron-job.org was considered but rejected for storing this token: its [FAQ](https://cron-job.org/en/faq/) says executor requests do not check HTTPS certificates, and its published executor disables peer/host verification. The owner's newly activated account has no configured job or shared credential. No further account signup is needed for the existing Cloudflare account.

## Acceptance and operation

Activated on 23 October 2026 with Worker version `d40813ce-f915-48b4-a2a0-3114583393ef`. Scheduled invocations at 10:13 and 10:23 SAST produced successful [run 39923161227](https://github.com/blendproperty/stor24-portal/actions/runs/39923161227) and [run 39924312256](https://github.com/blendproperty/stor24-portal/actions/runs/39924312256), with matching portal evidence at 10:14 and 10:24. Temporary Wrangler access was logged out and its previous OAuth token was rejected by Cloudflare. The separate GitHub secret expires **21 January 2027** and needs owner renewal before then. Preserve the existing **US$15 monthly GitHub Actions cap**; runner usage can stop monitoring when the allowance/cap is exhausted.

Allow up to 15 minutes for Cloudflare cron propagation. Observe at least two real scheduled invocations around ten minutes apart, corresponding successful GitHub runs and fresh matching portal evidence. HTTP acceptance, a manual test or one successful run alone is insufficient. Inspect Worker failures and token-expiry behaviour; scheduler-failure notification remains an explicit configuration/verification gate.

Cloudflare is the sole ten-minute scheduler after two actual scheduled runs have been verified. The GitHub workflow retains dispatch for this trigger and manual recovery, without a duplicate native cron. Restoring cadence uses more GitHub runner minutes; preserve the existing spending cap. The Worker makes one request and fails on transport/HTTP rejection without replaying uncertain dispatches. Neither provider promises exact timing.

Rollback: restore the previous GitHub cron (`3-59/10 * * * *`) through the normal checked release before removing the Cloudflare cron. Allow propagation, then revoke the GitHub credential. Manual GitHub dispatch remains available throughout; do not leave both automatic triggers disabled.

Sources: [GitHub dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [Cloudflare cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
