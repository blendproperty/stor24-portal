import { MarketProfileSummary } from "./market-profile-summary";
import { useMemo, useState } from "react";
import type { MarketingWorkspace } from "@/lib/marketing-service";
import { marketingIntelligence, ratio } from "@/lib/marketing-intelligence";
import { southAfricaDateKey } from "@/lib/south-africa-time";
const money = (n: number | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: "ZAR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(n);
const percent = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
type Intelligence = ReturnType<typeof marketingIntelligence>;
function Comparison({
  current,
  previous,
  label,
}: {
  current: number;
  previous: number;
  label: string;
}) {
  const change = ratio(current - previous, previous, 100);
  return (
    <div className="marketing-comparison">
      <span>{label}</span>
      <strong>{current.toLocaleString()}</strong>
      <small>
        {change === null
          ? current
            ? "New activity; previous period zero"
            : "No activity in either period"
          : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`}{" "}
        · previous {previous.toLocaleString()}
      </small>
    </div>
  );
}
function ChannelTable({ intelligence }: { intelligence: Intelligence }) {
  return (
    <div className="marketing-table-scroll">
      <table>
        <thead>
          <tr>
            {[
              "Channel",
              "Enquiries",
              "Move-ins",
              "Spend",
              "CTR",
              "CPC",
              "CPM",
              "Cost / enquiry",
              "Cost / move-in",
            ].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {intelligence.channels.map((c) => (
            <tr key={c.label}>
              <td>
                <strong>{c.label}</strong>
                <small className="marketing-cell-note">
                  {c.registered
                    ? "Registered campaign activity"
                    : "No matched campaign spend"}
                </small>
              </td>
              <td>{c.leads}</td>
              <td>{c.won}</td>
              <td>{c.registered ? money(c.spend) : "—"}</td>
              <td>
                {c.registered
                  ? percent(ratio(c.clicks, c.impressions, 100))
                  : "—"}
              </td>
              <td>{c.registered ? money(ratio(c.spend, c.clicks)) : "—"}</td>
              <td>
                {c.registered
                  ? money(ratio(c.spend, c.impressions, 1000))
                  : "—"}
              </td>
              <td>{c.registered ? money(ratio(c.spend, c.leads)) : "—"}</td>
              <td>{c.registered ? money(ratio(c.spend, c.won)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function MarketingCommandCentre({
  data,
  from,
  to,
  facility,
  view,
}: {
  data: MarketingWorkspace;
  from: string;
  to: string;
  facility: string;
  view: string;
}) {
  const intelligence = useMemo(
    () => marketingIntelligence(data, from, to, facility),
    [data, from, to, facility],
  );
  const { current, previous, budgets } = intelligence;
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const campaign = current.campaigns.find((c) => c.id === selected);
  const totalBudget = budgets.reduce((n, c) => n + c.budget, 0),
    lifetimeSpend = budgets.reduce((n, c) => n + c.lifetimeSpend, 0);
  const recordedActivities = budgets
    .flatMap((c) => c.activities.map((a) => ({ ...a, campaignName: c.name })))
    .filter((a) => {
      const day = southAfricaDateKey(new Date(a.occurredAt));
      return day >= from && day <= to;
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const days = [
    ...new Set(
      recordedActivities.map((a) => southAfricaDateKey(new Date(a.occurredAt))),
    ),
  ];
  if (view === "overview")
    return (
      <>

        <section className="marketing-executive">
          <div>
            <p className="marketing-eyebrow">PERFORMANCE AT A GLANCE</p>
            <h2>Your marketing command centre</h2>
            <p>
              {from} — {to} · compared with {intelligence.previousFrom} —{" "}
              {intelligence.previousTo}
            </p>
          </div>
          <div className="marketing-comparisons">
            <Comparison
              label="Enquiries"
              current={current.leads}
              previous={previous.leads}
            />
            <Comparison
              label="Recorded clicks"
              current={current.clicks}
              previous={previous.clicks}
            />
            <Comparison
              label="Recorded impressions"
              current={current.impressions}
              previous={previous.impressions}
            />
          </div>
        </section>
        <div className="marketing-efficiency">
          {[
            {
              label: "Click-through rate",
              value: percent(ratio(current.clicks, current.impressions, 100)),
              note: "Recorded clicks / impressions",
            },
            {
              label: "Cost per click",
              value: money(ratio(current.spend, current.clicks)),
              note: "Recorded campaign activity",
            },
            {
              label: "Cost per attributed enquiry",
              value: money(ratio(current.spend, intelligence.registeredLeads)),
              note: "Matched registered campaigns only",
            },
            {
              label: "Campaign budget remaining",
              value: money(totalBudget - lifetimeSpend),
              note: "Lifetime budget less recorded spend",
            },
          ].map((k) => (
            <article key={k.label}>
              <span>{k.label}</span>
              <strong>{k.value}</strong>
              <small>{k.note}</small>
            </article>
          ))}
        </div>
        <MarketProfileSummary caption="Selected store and reporting period. Self-reported answers; missing responses remain unknown. Gender is voluntary and never inferred." groups={[{title:"Storage use",rows:current.storageUses},{title:"How they heard about us",rows:current.discoverySources},{title:"Gender",rows:current.genders}]}/>
        <section className="marketing-card">
          <h2>What needs attention</h2>
          <div className="marketing-attention">
            {!data.campaigns.length && (
              <p>
                Create your first campaign, then generate a different tracked
                link for each ad, email, social placement or QR code.
              </p>
            )}
            {current.unknown > 0 && (
              <p>
                <strong>
                  {current.unknown} enquiries lack a consented website journey.
                </strong>{" "}
                Historical and rejected-consent enquiries cannot be
                retrospectively assigned to campaigns.
              </p>
            )}
            {budgets
              .filter((c) => c.remaining < 0)
              .map((c) => (
                <p key={c.id}>
                  <strong>{c.name}</strong> is {money(-c.remaining)} over its
                  lifetime budget.
                </p>
              ))}
            {budgets
              .filter((c) => c.status === "ACTIVE" && !c.links.length)
              .map((c) => (
                <p key={c.id}>
                  <strong>{c.name}</strong> is active without a registered
                  placement link.
                </p>
              ))}
            <p>
              Website traffic and advertising use separate reporting connections.
              Check their connection status and live provider figures below.
              Recorded activity remains separate from provider delivery.
            </p>
          </div>
        </section>
      </>
    );
  if (view === "channels")
    return (
      <>
        <div className="marketing-chart-grid">
          <section className="marketing-card">
            <h2>Recorded channel spend</h2>
            <p>Share of recorded spend for registered campaign channels.</p>
            <div className="marketing-channel-bars">
              {intelligence.channels
                .filter((c) => c.registered && c.spend > 0)
                .map((c) => (
                  <div key={c.label}>
                    <span>{c.label}</span>
                    <strong>{money(c.spend)}</strong>
                    <div>
                      <i
                        style={{
                          width: `${(c.spend / Math.max(1, current.spend)) * 100}%`,
                          background: "#294f60",
                        }}
                      />
                    </div>
                    <small>
                      {percent(ratio(c.spend, current.spend, 100))} of recorded
                      spend
                    </small>
                  </div>
                ))}
            </div>
            {!current.spend && (
              <p className="marketing-empty">
                Record campaign spend to compare channel investment.
              </p>
            )}
          </section>
          <section className="marketing-card">
            <h2>Enquiry mix</h2>
            <p>
              All enquiry sources, including those without registered campaign
              costs.
            </p>
            <div className="marketing-channel-bars">
              {intelligence.channels
                .filter((c) => c.leads > 0)
                .map((c) => (
                  <div key={c.label}>
                    <span>{c.label}</span>
                    <strong>{c.leads} enquiries</strong>
                    <div>
                      <i
                        style={{
                          width: `${(c.leads / Math.max(1, current.leads)) * 100}%`,
                        }}
                      />
                    </div>
                    <small>
                      {percent(ratio(c.leads, current.leads, 100))} of enquiries
                      · {c.won} confirmed move-ins
                    </small>
                  </div>
                ))}
            </div>
            {!current.leads && (
              <p className="marketing-empty">
                Enquiry sources appear as enquiries arrive.
              </p>
            )}
          </section>
        </div>
        <section className="marketing-card">
          <h2>Channel performance</h2>
          <p>
            Compare acquisition and recorded campaign efficiency. Spend is
            assigned only to its registered campaign channel; unknown sources
            have no invented cost.
          </p>
          <ChannelTable intelligence={intelligence} />
          {!intelligence.channels.length && (
            <p className="marketing-empty">
              No enquiries or campaign activity in this period.
            </p>
          )}
        </section>
        <section className="marketing-card">
          <h2>Campaign analysis</h2>
          <p>Select a campaign to inspect its results, placements and spend.</p>
          <label className="marketing-analysis-filter">
            Campaign
            <select
              aria-label="Campaign"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a campaign</option>
              {current.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {campaign && (
            <>
              <div className="marketing-efficiency">
                {[
                  { label: "Enquiries", value: String(campaign.leads) },
                  { label: "Confirmed move-ins", value: String(campaign.won) },
                  { label: "Recorded spend", value: money(campaign.spend) },
                  { label: "Cost per enquiry", value: money(campaign.cpl) },
                ].map((k) => (
                  <article key={k.label}>
                    <span>{k.label}</span>
                    <strong>{k.value}</strong>
                  </article>
                ))}
              </div>
              <p>
                {campaign.source} / {campaign.medium} · {campaign.status} ·{" "}
                {campaign.clicks.toLocaleString()} clicks ·{" "}
                {campaign.impressions.toLocaleString()} impressions
              </p>
              <div className="marketing-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Placement</th>
                      <th>Landing page</th>
                      <th>Enquiries</th>
                      <th>Move-ins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intelligence.placements
                      .filter((p) => p.campaignId === campaign.id)
                      .map((p) => (
                        <tr key={p.id}>
                          <td>{p.label}</td>
                          <td>{p.landingPage}</td>
                          <td>{p.leads}</td>
                          <td>{p.won}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </>
    );
  if (view === "budgets")
    return (
      <>
        <section className="marketing-executive">
          <div>
            <p className="marketing-eyebrow">SPEND CONTROL</p>
            <h2>Budgets &amp; pacing</h2>
            <p>
              Campaign lifetime budgets and spend, with scheduled pacing to the
              reporting end date.
            </p>
          </div>
          <div className="marketing-budget-totals">
            <span>
              Total budgets<strong>{money(totalBudget)}</strong>
            </span>
            <span>
              Lifetime recorded spend<strong>{money(lifetimeSpend)}</strong>
            </span>
            <span>
              Remaining<strong>{money(totalBudget - lifetimeSpend)}</strong>
            </span>
          </div>
        </section>
        <div className="marketing-budget-grid">
          {budgets.map((c) => (
            <article className="marketing-card" key={c.id}>
              <div className="marketing-card-title">
                <h2>{c.name}</h2>
                <span className="marketing-status">{c.status}</span>
              </div>
              <p>
                {c.source} / {c.medium}
              </p>
              <div className="marketing-budget-value">
                <strong>{money(c.lifetimeSpend)}</strong>
                <span>of {money(c.budget)} lifetime budget</span>
              </div>
              <progress
                max={Math.max(1, c.budget)}
                value={Math.min(c.lifetimeSpend, Math.max(1, c.budget))}
                aria-label={`${c.name} budget used`}
              />
              <p>
                {c.utilisation === null
                  ? "No budget set"
                  : `${percent(c.utilisation)} used`}{" "}
                · {money(c.remaining)} remaining
              </p>
              <dl className="marketing-budget-detail">
                <dt>Selected-period spend</dt>
                <dd>
                  {money(
                    current.campaigns.find((x) => x.id === c.id)?.spend ?? 0,
                  )}
                </dd>
                <dt>Spend through {to}</dt>
                <dd>{money(c.spendToCutoff)}</dd>
                <dt>Scheduled budget through {to}</dt>
                <dd>{money(c.expectedToDate)}</dd>
                <dt>Recorded pacing variance</dt>
                <dd>
                  {c.expectedToDate === null
                    ? "Set an end date for pacing"
                    : money(c.spendToCutoff - c.expectedToDate)}
                </dd>
              </dl>
              <p>
                Positive variance means spend exceeds the scheduled budget.
                Lifetime spend can include entries after the selected reporting
                period.
              </p>
            </article>
          ))}
        </div>
        {!budgets.length && (
          <section className="marketing-card">
            <p className="marketing-empty">
              Campaign budgets and pacing appear when campaigns are created.
            </p>
          </section>
        )}
      </>
    );
  if (view === "placements")
    return (
      <>
        <section className="marketing-card">
          <div className="marketing-card-title">
            <div>
              <h2>Placement &amp; creative performance</h2>
              <p>
                Consented enquiries matched to registered placement IDs. Clicks
                and spend are currently recorded at campaign level.
              </p>
            </div>
            <label className="marketing-analysis-filter">
              Find placement
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Campaign, placement or page"
              />
            </label>
          </div>
          <div className="marketing-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Placement",
                    "Campaign",
                    "Source / medium",
                    "Landing page",
                    "Enquiries",
                    "Move-ins",
                    "Enquiry to move-in",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {intelligence.placements
                  .filter((p) =>
                    `${p.label} ${p.campaignName} ${p.landingPage}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td>{p.campaignName}</td>
                      <td>
                        {p.source} / {p.medium}
                      </td>
                      <td>{p.landingPage}</td>
                      <td>{p.leads}</td>
                      <td>{p.won}</td>
                      <td>{percent(ratio(p.won, p.leads, 100))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!intelligence.placements.length && (
            <p className="marketing-empty">
              Create registered links to compare creatives and placements.
            </p>
          )}
        </section>
        <section className="marketing-card">
          <h2>Landing-page contribution</h2>
          <p>
            Attributed enquiry entry pages, including journeys without a
            registered campaign. These are enquiry counts, not visitor
            conversion rates.
          </p>
          <div className="marketing-channel-bars">
            {intelligence.landingPages.map((p) => (
              <div key={p.path}>
                <span>{p.path}</span>
                <strong>{p.leads} enquiries</strong>
                <div>
                  <i
                    style={{
                      width: `${(p.leads / Math.max(1, current.attributed)) * 100}%`,
                    }}
                  />
                </div>
                <small>{p.won} confirmed move-ins</small>
              </div>
            ))}
          </div>
          {!intelligence.landingPages.length && (
            <p className="marketing-empty">
              Landing-page results appear when consented journeys are linked to
              enquiries.
            </p>
          )}
        </section>
      </>
    );
  if (view === "calendar")
    return (
      <>
        <section className="marketing-card">
          <h2>Marketing activity calendar</h2>
          <p>
            Recorded work grouped by South African day in the selected period.
            This shows activity history, not proof that scheduled campaigns were
            published.
          </p>
          <div className="marketing-calendar">
            {days.map((day) => (
              <article key={day}>
                <div className="marketing-calendar-date">
                  <strong>
                    {new Date(day + "T12:00:00+02:00").toLocaleDateString(
                      "en-ZA",
                      {
                        day: "numeric",
                        month: "short",
                        timeZone: "Africa/Johannesburg",
                      },
                    )}
                  </strong>
                  <span>
                    {new Date(day + "T12:00:00+02:00").toLocaleDateString(
                      "en-ZA",
                      { weekday: "long", timeZone: "Africa/Johannesburg" },
                    )}
                  </span>
                </div>
                <div>
                  {recordedActivities
                    .filter(
                      (a) => southAfricaDateKey(new Date(a.occurredAt)) === day,
                    )
                    .map((a) => (
                      <div className="marketing-calendar-entry" key={a.id}>
                        <span className="marketing-status">{a.kind}</span>
                        <strong>{a.title}</strong>
                        <span>{a.campaignName}</span>
                        <span>
                          {money(a.spend)} · {a.clicks.toLocaleString()} clicks
                        </span>
                        {a.notes && <p>{a.notes}</p>}
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </div>
          {!days.length && (
            <p className="marketing-empty">
              Log activity to build your marketing calendar.
            </p>
          )}
        </section>
        <section className="marketing-card">
          <h2>Campaign schedule</h2>
          <p>
            All campaigns permitted by the selected store filter, including
            future start dates.
          </p>
          <div className="marketing-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {budgets
                  .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{southAfricaDateKey(new Date(c.startsAt))}</td>
                      <td>
                        {c.endsAt
                          ? southAfricaDateKey(new Date(c.endsAt))
                          : "Open ended"}
                      </td>
                      <td>{c.status}</td>
                      <td>{money(c.budget)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  return null;
}
