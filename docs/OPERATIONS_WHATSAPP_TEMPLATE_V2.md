# Operations WhatsApp template proposal — 9 October 2026

WhatsApp renders labelled rows rather than HTML tables. Submit this fixed layout as a new utility template through Twilio/Meta; retain the approved three-variable template until approval and an explicit configuration switch. Variables must be single-line, allowlisted aggregate evidence. No customer data, raw logs, host addresses or credentials.

```text
STOR24 operations notification

Time: {{1}}
Status: {{2}}
Failure: {{3}}
Details: {{4}}
Severity: {{5}}
Impact: {{6}}
Action: {{7}}
Response priority: {{8}}
Suggested action timeframe: {{9}}
Suggested remedy: {{10}}
Escalation: {{11}}

Review the STOR24 operations monitor for evidence.
```

Example: Time 8 Oct 2026, 23:42:23 SAST; Status FAILURE; Failure Monitoring connection timed out; Details SSH connection exceeded 20 seconds, backup and resource checks could not run; Severity WARNING; Impact Backup/resource health unverified, application readiness passed; Action Review monitor and investigate connection.

Provider submission/approval, sender version support, configuration and recipient delivery verification remain outstanding. Existing approved template now receives severity, cause, impact, action and SAST time using its existing three fields. Its fixed TEST disclaimer is retained by the provider and cannot be changed by altering variables.

Suggested response policy: active HIGH failures require immediate investigation; an unresolved WARNING requires a fresh health/monitor check within two hours and must not be deferred overnight. Escalate sooner if application health fails, or if a fresh check still fails/health remains unverified within two hours. Recovered incidents may receive next-business-day follow-up if checks remain healthy. These are suggested operational targets, not a contractual SLA; severity alone does not establish that an overnight delay is safe.
