# Independent monitor trigger - prepared, not activated

`scripts/external-monitor-worker.mjs` dispatches only the existing STOR24 production monitor on `main`, with test alerts disabled. `wrangler.monitor.json` schedules it at minutes 03/13/23/33/43/53 UTC each hour. GitHub still performs the checks, alerts and dashboard transfer. There is no public HTTP handler, route, workers.dev or preview URL.

## Credential approval and configuration

Before creating access, obtain owner confirmation for a fine-grained GitHub token restricted to **blendproperty/stor24-portal**, **Actions: write**, automatic read-only metadata, and a 90-day expiry. Actions write can manage repository Actions beyond dispatching this workflow; GitHub has no dispatch-only token permission. Store it only as the existing Cloudflare account's encrypted Worker secret `GITHUB_MONITOR_TOKEN`, never in Git, chat, screenshots, configuration or logs. Record the expiry and renewal gate without the credential. Do not upgrade plans or alter spending limits.

Deploy only the reviewed, checked source. Configure the secret before activating the cron. With an authorised local Cloudflare session, Wrangler supports `npx wrangler deploy --config wrangler.monitor.json`; use the Cloudflare dashboard for secret entry and inspect the resulting settings. Keep public URLs disabled. A successful local bundle is not provider deployment proof.

cron-job.org was considered but rejected for storing this token: its [FAQ](https://cron-job.org/en/faq/) says executor requests do not check HTTPS certificates, and its published executor disables peer/host verification. The owner's newly activated account has no configured job or shared credential. No further account signup is needed for the existing Cloudflare account.

## Acceptance and operation

Allow up to 15 minutes for Cloudflare cron propagation. Observe at least two real scheduled invocations around ten minutes apart, corresponding successful GitHub runs and fresh matching portal evidence. HTTP acceptance, a manual test or one successful run alone is insufficient. Inspect Worker failures and token-expiry behaviour; scheduler-failure notification remains an explicit configuration/verification gate.

Keep the existing GitHub schedule until the independent trigger is proven, then resolve duplicate triggers through a reviewed workflow change. Restoring cadence uses more GitHub runner minutes; preserve the existing spending cap. The Worker makes one request and fails on transport/HTTP rejection without replaying uncertain dispatches. Neither provider promises exact timing.

Rollback: remove the Cloudflare cron, allow propagation, then revoke the GitHub credential. Existing GitHub monitoring remains independently configured.

Sources: [GitHub dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [Cloudflare cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
