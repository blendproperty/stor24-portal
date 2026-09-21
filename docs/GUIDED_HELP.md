# Staff guided help

Expanded across the staff backend on 21 September 2026. The earlier three-guide release was an initial increment, not the full requested scope.

## Using it

Choose **Guide me** in the staff toolbar. **Help with this page** starts its main tutorial; **Also on this screen** exposes additional workflows such as payment, transfer, move-out, statements, packages and setup. Search matches titles, descriptions and step text. Work area filters the library. Clear filters restores every guide.

Starting a tutorial turns **Guide mode** on. **Show me on this page** outlines the relevant visible area without operating it. **Read & next** records reading only. Back, the checklist, Restart, Pause and Close remain available. Escape closes the guide unless a business modal owns the interaction. Modal forms remain above the tutorial. Switching off removes highlights and returns to the library; it does not erase reading progress. Reloading does not automatically reopen a guide.

Preferences are scoped to the signed-in staff user in this browser, with cross-tab synchronisation. No customer IDs, financial information or form values are stored. There is no cross-device progress or training certification. Storage denial leaves temporary guidance available with a visible warning. Normal permissions and transaction gates remain authoritative; the library describes features but never grants access to them.

Guidance never submits a reservation, receipt, agreement, message, configuration, stock change or access action. Opening another screen is deliberate. A selected statement uses its real account URL; the guide never invents or selects an account. Missing targets explain which screen, tab, selection or readiness condition is needed.

## Coverage

40 tutorials contain 192 reading steps across every current staff page and the standalone offline workspace:

| Work area | Tutorials |
| --- | --- |
| Customer journey | Orientation; customer records and consent; lead capture; reservations; signed-booking move-in checks; unsigned agreement preparation; transfers; move-out |
| Money and accounts | Account reading; received payments; statements and portal invitations; billing/reconciliation/daily close; collections; adjustments/reversals/refunds; Netcash outcomes; proration preview |
| Facility operations | Tasks and maintenance; units/types/rates/renumbering/batch tools; facility maps; merchandise and stock; packages; paid-order supply; insurance; facial access; calendar |
| Reports and oversight | Report parameters and CSV exports; portfolio graphs; system audit |
| Administration | Store setup/public visibility; tenant defaults; all 18 Program defaults groups; employees/invitations/permissions; settings/password/MFA/recovery; communications; integration health and signing reconciliation; HikCentral; Netcash test configuration; phone integration |
| Offline work | Device-readiness register; preparation/unlock/capture/unit requests/sync/conflicts/refresh/erasure |

All 31 staff Next pages (including the dynamic account statement) and `/offline-workspace.html` have contextual help. Authentication and customer-facing pages are not staff tutorial surfaces; sign-in/recovery and staff handling of customer portal invitations are explained from the appropriate staff guide.

The content distinguishes implemented controls from unfinished screens: Collections call queue/export buttons, the Adjustments information hub, the Phone configuration shell and saved-but-unverified automation/defaults are explicitly explained. The calculator's fixed 31-day assumption is stated. Test payments, mandates, internal ledger matching, insurer records and saved access configuration are not represented as real settlement, completed handover, accepted insurance or working doors.

## Offline tutorial

The standalone page has its own Guide me panel and on/off switch, Back/Next, Restart, Pause, visible-area highlight and missing-target instructions. It uses the same authored offline lesson as the staff library. The small browser controller never opens the encrypted operational database or calls business APIs. Its preference and reading position are device-level, separate from the staff-user progress.

Load the updated site online so its service worker can cache the offline page, script and stylesheet. The tutorial can then be used during an outage. A server readiness row still does not prove the local snapshot exists, is current or can be unlocked. Tutorial testing never prepares/erases a snapshot or submits an offline enquiry.

## Maintenance

- Existing booking lessons and preference logic: `src/lib/guided-help.ts`; expanded catalogue: `src/lib/guided-help-catalog.ts`.
- Staff panel: `src/components/guided-help.tsx`; stylesheet: `src/styles/guided-help.css`.
- Offline controller: `src/pwa/offline-guided-help.ts`; build: `scripts/build-offline-guide.mjs`; style: `public/offline-guided-help.css`.
- `prebuild` and `predev` generate the offline bundle. It is ignored by Git and lint; its TypeScript source is checked. The production Docker builder includes the generated asset in the final public directory.
- Editorial selectors are fixed constants, scoped to the staff content area. Keep labels and selectors aligned with the actual screen. Never use guide navigation to execute a business action or invent a record ID.
- Keep stable IDs for wording corrections; change step IDs when their meaning materially changes so prior reading is not credited for different work.
- Add every staff page and navigation destination to contextual coverage. The route test derives current pages from the filesystem and fails on an uncovered addition. Program-default tab coverage is checked against the actual component.

## Verification and acceptance boundaries

`npm test` checks corrupt storage, per-user isolation, progress bounds, skipped-step honesty, route coverage, dynamic statements, search/category matching, all Program defaults tabs and offline asset/no-write boundaries.

`npm run test:guides` exercises the real staff tutorial, shell, reservations and move-in components against invented fixtures, then reads every step of every tutorial. It checks search, category/empty states, highlights, reload/resume, restart/completion, switch-off, cross-tab state, storage denial and 390/768/1280px bounds. It also loads the actual standalone offline page and tests the tutorial during simulated network loss, without unlocking or changing business data. The fixture does not simulate every business module and does not prove provider, payment, database or physical operations. All non-GET requests are rejected and recorded; the expected count is zero. CI retains screenshots.

After deployment, verify the expanded library and contextual starts on the real signed-in staff pages, plus search, settings-tab explanations, account context, offline help and narrow-screen behaviour. Do not trigger sends, configuration changes or transactions to test a tutorial. Staff training acceptance and the existing finance, provider, legal, data, physical handover/door and launch-approval gates remain separate in `PROJECT_CONTEXT.md`.
