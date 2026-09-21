# Staff guided help

First release: 21 September 2026.

## Using it

Choose **Guide me** in the staff toolbar. The panel explains the current page and offers three workflows:

1. Find your way around: dashboard metrics, priorities, navigation and activity.
2. Manage a reservation: filters, hold review, creation, maintenance and move-in handoff.
3. Prepare a move-in: existing reservation, signed versus unsigned agreement path, eligible payment/date checks and physical key handover.

Starting a guide turns **Guide mode** on. **Show me on this page** outlines the relevant area; it does not operate it. **Read & next** records reading progress. Back, the checklist, Restart, Pause and Close remain available. Escape closes the guide unless a business modal is open. A business modal remains above the tutorial.

Turning Guide mode off removes highlights and returns to the guide library. Guide me remains available to turn it back on. Closing or reloading does not automatically reopen a tutorial. Select Continue where you left off to resume. New users start with the mode off; no automatic tour interrupts their work.

Preferences and reading progress are stored in this browser, under a key scoped to the signed-in user. They do not synchronise between devices. No customer details, reservation identifiers, payment information or form values are stored by this feature. Storage denial is handled with temporary in-memory progress and a visible persistence notice. Changes synchronise between tabs for the same user.

The checklist measures **reading**, not operational completion. It cannot create a reservation, send an agreement, record a receipt, confirm handover or grant access. Opening another screen is an explicit action; a same-screen tutorial does not change the URL or drop a selected reservation. Normal server permissions and operational gates remain authoritative. Missing or hidden targets produce guidance rather than clicking a substitute control.

## Maintenance

- Editorial content: `src/lib/guided-help.ts`. Use plain staff language, actual current labels, fixed read-only routes and stable `data-guide` target names.
- Controller: `src/components/guided-help.tsx`, mounted only in the authenticated staff shell. Auth and tenant pages retain their existing shell exclusions.
- Presentation: `src/styles/guided-help.css`. Desktop side panel; scrollable bottom panel at narrow widths; non-modal with no keyboard trap. Highlights do not intercept clicks. Respect reduced-motion preferences.
- Keep step IDs stable when correcting wording. When a workflow materially changes, introduce new step IDs or deliberately version the stored preferences so old reading progress is not misleading.
- Add page context in `pageHelp`; use longest route matching for child screens. Unsupported pages get general guidance, not an invented complete workflow.
- Broader guided workflows (billing, collections, move-out and role-specific curricula), cross-device storage, administrative training reports and a demo-data training mode are outside this release.

## Verification

`npm test` covers corrupt/obsolete state, step bounds, deduplication, skipped-step honesty, per-user keys and route matching. `npm run test:guides` builds the actual client shell/reservations/move-in components against invented fixtures with all server actions stubbed to reject. It checks desktop and 390/768/1280px layouts, highlights, preferences, resume/restart, cross-page continuity, missing targets, cross-tab switch-off, unavailable storage and zero operational submissions. Screenshots are saved under `output/guided-help/` and uploaded by CI.

Install Chromium with `npx playwright install chromium`; Windows can also run with `PLAYWRIGHT_CHANNEL=msedge`. These are isolated component browser checks, not database/provider or live staff acceptance tests.

After deployment, verify with a normal staff session: open Guide me, read a dashboard step, toggle off/on, reload and resume, follow an existing reservation into move-in, check signed/unsigned target guidance, and pause/close at desktop and phone widths. Do not submit a receipt, agreement or key handover to test this feature. Preserve all legal, provider, payment, access, data, training and launch-approval gates in PROJECT_CONTEXT.md.
