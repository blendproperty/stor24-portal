# Project Engineering and Readiness Standard

Date: 4 October 2026  
Applies to: Brett Dovey's software projects, websites, integrations and automations  
Status: Requirements baseline. Current project compliance has not been audited.

## Purpose

Use AI to accelerate delivery while protecting customer data, financial records, service availability and operating costs. A polished interface or successful build is not sufficient evidence that a business workflow is ready for production.

Apply requirements according to the project's actual risks. Systems handling money, identity, leases or physical access require the strongest validation. Informational websites require proportionate checks for publishing, forms, privacy, availability and recovery.

## How to interpret the source article

The article's central warning is useful: rapid software generation can hide operational weaknesses. Its anecdotes, costs and risk percentages are not established evidence about this portfolio. They do not justify automatically rebuilding existing applications.

Managed authentication and payment providers reduce implementation burden but do not replace application permissions, safe state changes or reconciliation. Internal dashboards can carry significant risk. A short architecture review is a starting point, not proof of production readiness.

## Requirements for every project

| Area | Required controls | Acceptance evidence |
|---|---|---|
| Access and permissions | Enforce permissions on the server for each action and record; use maintained authentication components. | Tests show that customers, tenants and staff cannot access other users' records or perform unauthorized actions, including by changing record IDs. |
| Database integrity | Use reviewed migrations, appropriate primary keys, relationships, uniqueness constraints, indexes and bounded connections. | Validate migrations on representative data; inspect critical queries and prove simultaneous writes preserve business rules. |
| Critical actions | Protect payments, receipts, bookings, rewards and access grants against retries and concurrent requests. | Duplicate, repeated and simultaneous requests produce the intended single business outcome and a traceable history. |
| Backup and recovery | Define backup coverage, retention, custody, recovery time and acceptable data loss. | Restore into an isolated environment and verify usable records, files and required configuration. Record the date and outcome. |
| Capacity and cost | Bound requests, uploads, expensive processing and retries; monitor capacity and spending. | Exercise realistic peak workloads and failure conditions. Record response times, error rates, resource use and cost controls. |
| Monitoring and audit history | Alert on meaningful failures and record important changes without exposing secrets. | Demonstrate detection and trace an action through the application, database and external provider where applicable. |
| Controlled releases | Review changes, run relevant tests, prepare migration and rollback procedures, and verify deployment configuration. | Record the released revision, configuration evidence and live checks separately from build results. |
| Operational acceptance | Assign owners and complete relevant staff training, workflow UAT, reconciliation and approvals. | Named acceptance evidence and explicitly preserved outstanding gates. |

Where an area does not apply, record why rather than silently omitting it. Evidence should identify its environment, date, scope and limitations.

## Payments and external integrations

- Verify incoming notifications using the provider's supported authentication or signature method.
- Make retries safe. Persist duplicate protection with appropriate unique constraints and atomic state changes.
- Handle notifications arriving late, repeatedly or out of order according to the provider's documented behavior.
- Track pending, successful, failed and uncertain outcomes explicitly.
- Reconcile application records against provider records. An accepted API request is not proof of settlement, delivery or a physical customer effect.
- A database transaction alone cannot make an external payment or device action atomic. Use provider-supported idempotency, durable processing and reconciliation appropriate to the integration.
- Keep sandbox and production evidence distinct. Do not use real funds, live financial records or physical access changes as simulated tests.

## Capacity and spending

Set limits based on expected use and business impact rather than an arbitrary concurrent-user target. Control request size, processing time, per-user consumption, background jobs and retry loops.

Provider budget settings must be checked for their actual enforcement behavior. OpenAI API project budgets are soft alert thresholds rather than hard spending caps. Add application usage limits and a controlled stop mechanism where required.

Cache only where correct and safe. Scope sensitive cached data to authorized users or tenants, and invalidate it when source data or permissions change. Avoid caching critical state in a way that permits stale financial or access decisions.

## Project priorities

These are assessment priorities based on known project areas, not confirmed current defects or a complete inventory.

| Project area | Priority validation |
|---|---|
| STOR24 CRM and customer portal | Unit holds and double booking; customer and tenant separation; payment-to-ledger reconciliation; lease and move-in gates; recovery of customer and financial records. |
| FOND and Midpoint Hub | Payment-to-order consistency; duplicate reward redemption; staff permissions; provider outages; kitchen handoff and POS reconciliation. |
| BlendSign | Document access; signer permissions; document integrity; signature evidence; duplicate callbacks and retention. |
| EMS, HikCentral and access integrations | Person and site permissions; revocation; failed synchronization; audit history and physical-device UAT. |
| Midpoint, OnPoint and Blend Listings websites | CMS permissions; lead-form persistence and delivery; spam controls; privacy; backups and deployment checks. |
| Outlook and other automations | Account and recipient scope; repeat-run safety; recoverable changes; delivery verification and approval boundaries. |

## Assessment and remediation workflow

1. Identify the canonical repository, checkout, branch, remote head, deployed revision and project owner.
2. Read the current PROJECT_CONTEXT.md and inventory critical workflows, data and providers.
3. Trace one complete business transaction, including persistence and external side effects.
4. Inspect authorization, integrity, retries, concurrency, recovery and failure handling.
5. Validate in an isolated environment with representative data and meaningful tests.
6. Fix one issue, validate it, and then move to the next. Preserve unrelated changes.
7. Promote through the applicable release process and verify the live outcome safely.
8. Update each affected canonical PROJECT_CONTEXT.md and reconcile any tracker in scope before final handoff.

Begin with systems handling money, identity, leases or physical access. Use independent specialist review where the impact and uncertainty justify it; review duration alone is not an acceptance criterion.

## Mandatory completion evidence

Whenever a project task has passed its relevant testing or validation, update its canonical PROJECT_CONTEXT.md before reporting that task as complete. For cross-repository work, update every affected canonical file.

Record each evidence state separately:

| Evidence state | Required record |
|---|---|
| Implementation | What changed, scope, affected components and remaining gaps. |
| Testing | Environment, checks performed, results, date and limitations. |
| Commit and push | Commit identifiers, branch and verified remote presence. |
| Merge | Pull request or merge evidence and resulting revision, or explicit pending/not applicable status. |
| Deployment and configuration | Environment, deployed revision, configuration changes and rollback evidence. |
| Live production verification | Dated checks of the actual deployed workflow, outcome and remaining UAT or provider limitations. |

Do not describe code-only, simulated, partially tested or unverified work as complete. Report the specific stage achieved, such as implementation complete and deployment pending.

Preserve all outstanding blockers, UAT, provider, data, training and approval gates. Include the context update in the commit and promotion where safe. Before final handoff, confirm PROJECT_CONTEXT.md is present on the intended remote branch. If Asana or another tracker is in scope, align its status and evidence with the context file.

## Reusable PROJECT_CONTEXT.md entry

```markdown
### YYYY-MM-DD — Task or release

- Scope:
- Implementation:
- Testing and validation: environment, evidence, result and limitations
- Commit and push: revision, branch and remote verification
- Merge: evidence or pending/not applicable
- Deployment and configuration: environment, revision and evidence
- Live production verification: dated outcome or not yet verified
- Outstanding gates: blockers, UAT, providers, data, training and approvals
- Tracker reconciliation: link and status, or not in scope
- Handoff status: precise stage achieved and remaining work
```

## Project acceptance checklist

- [ ] Canonical repository, checkout, branch and remote head verified.
- [ ] Critical workflows and external side effects documented.
- [ ] Permissions and data isolation validated.
- [ ] Relevant duplicate, retry and concurrency scenarios validated.
- [ ] Database changes and critical queries reviewed.
- [ ] Backup restoration and recovery evidence recorded.
- [ ] Capacity, spending controls and failure alerts validated.
- [ ] Release and rollback procedures recorded.
- [ ] Deployment configuration and live outcome verified where in scope.
- [ ] UAT, reconciliation, training and approvals completed or explicitly pending.
- [ ] Every affected PROJECT_CONTEXT.md updated with dated evidence.
- [ ] Context confirmed on the intended remote branch and tracker aligned where in scope.

An unchecked item is a visible gap, not automatic evidence that the system is defective. Record applicability, owner and next action.

## References

- User-supplied article: “The Vibe Coding Trap: Why AI-Generated MVPs Are Quietly Bankrupting Early-Stage Startups,” Abul Kalam Azad, dated 25 September 2026. Reviewed as supplied; anecdotal claims were not independently verified.
- [OWASP Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
- [OpenAI API project management and budget behavior](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)
- Brett's permanent project completion and evidence instructions, supplied 4 October 2026.
