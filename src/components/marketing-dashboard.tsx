"use client";
import { auditedCsvDownload } from "@/lib/audited-csv-download";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarketingCommandCentre } from "./marketing-command-centre";
import { MarketingOutcomes } from "./marketing-outcomes";
import { MarketingDialog } from "./marketing-dialog";
import { MarketingABCPanel } from "./marketing-abc";
import {MarketingAdvertising} from "./marketing-advertising";
import { MarketingSearchConsole } from "./marketing-search-console";
import { MarketingTrafficChart } from "./marketing-traffic";
import {
  BarChart3,
  Download,
  Plus,
  Link as LinkIcon,
  RefreshCw,
  ArrowUpRight,
  Target,
  MousePointer2,
  Wallet,
  X,
} from "lucide-react";
import type { MarketingWorkspace } from "@/lib/marketing-service";
import { marketingIntelligence, ratio } from "@/lib/marketing-intelligence";
import { marketingReport } from "@/lib/marketing-reporting";
import {
  marketingSources,
  marketingMedia,
} from "@/lib/marketing-contract";
import { southAfricaDateKey } from "@/lib/south-africa-time";
const money = (n: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(n);
const date = (at: string) =>
  new Date(at).toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
  });
export function MarketingDashboard({ canManage }: { canManage: boolean }) {
  const [today] = useState(() => southAfricaDateKey(new Date())),
    [from, setFrom] = useState(() =>
      southAfricaDateKey(new Date(Date.now() - 29 * 86400000)),
    ),
    [to, setTo] = useState(today),
    [facility, setFacility] = useState(""),
    [tab, setTab] = useState("overview"),
    [data, setData] = useState<MarketingWorkspace | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reportVersion, setReportVersion] = useState(0),
    [modal, setModal] = useState<"campaign" | "link" | "activity" | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [copied, setCopied] = useState(""),
    [submissionId, setSubmissionId] = useState(""),
    [editingCampaign, setEditingCampaign] = useState<
      MarketingWorkspace["campaigns"][number] | null
    >(null),
    [editingActivity, setEditingActivity] = useState<
      MarketingWorkspace["campaigns"][number]["activities"][number] | null
    >(null);
  function openModal(kind: "campaign" | "link" | "activity") {
    setSubmissionId(crypto.randomUUID());
    setEditingCampaign(null);
    setEditingActivity(null);
    setFormError("");
    setModal(kind);
  }
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/marketing", { cache: "no-store" });
      if (!response.ok)
        throw Error("Marketing data could not load. Please retry.");
      const result = await response.json();
      setData(result.data);
      setError("");
      setReportVersion((version) => version + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load marketing.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/marketing", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw Error("Marketing data could not load. Please retry.");
        return response.json();
      })
      .then((result) => {
        if (active) {
          setData(result.data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const report = useMemo(
    () =>
      data
        ? marketingReport(data.leads, data.campaigns, from, to, facility)
        : null,
    [data, from, to, facility],
  );
  const campaigns =
    data?.campaigns.filter((c) => !facility || c.facilityId === facility) ?? [];
  const activities = campaigns
    .flatMap((c) => c.activities.map((a) => ({ ...a, campaignName: c.name })))
    .filter(
      (a) =>
        southAfricaDateKey(new Date(a.occurredAt)) >= from &&
        southAfricaDateKey(new Date(a.occurredAt)) <= to,
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  async function exportCsv() {
    if (!report) return;
    let rows: (string | number)[][] = [
      [
        "Campaign",
        "Source",
        "Medium",
        "Enquiries",
        "Moved in",
        "Recorded spend ZAR",
        "Recorded clicks",
        "Recorded impressions",
        "Cost per enquiry ZAR",
        "Cost per move-in ZAR",
      ],
      ...report.campaigns.map((c) => [
        c.name,
        c.source,
        c.medium,
        c.leads,
        c.won,
        c.spend,
        c.clicks,
        c.impressions,
        c.cpl?.toFixed(2) ?? "",
        c.cac?.toFixed(2) ?? "",
      ]),
    ];
    if (data) {
      const analysis = marketingIntelligence(data, from, to, facility);
      if(tab==='overview')rows.push([],['Customer profile category','Answer','Enquiries'],...[{category:'Storage use',rows:report.storageUses},{category:'Discovery source',rows:report.discoverySources},{category:'Gender (self-reported)',rows:report.genders}].flatMap(group=>group.rows.map(row=>[group.category,row.label,row.count])));
      if (tab === "channels")
        rows = [
          [
            "Channel",
            "Matched campaign spend",
            "Enquiries",
            "Move-ins",
            "Clicks",
            "Impressions",
            "CTR percent",
            "CPC ZAR",
            "CPM ZAR",
          ],
          ...analysis.channels.map((c) => [
            c.label,
            c.registered ? c.spend : "",
            c.leads,
            c.won,
            c.registered ? c.clicks : "",
            c.registered ? c.impressions : "",
            c.registered ? (ratio(c.clicks, c.impressions, 100) ?? "") : "",
            c.registered ? (ratio(c.spend, c.clicks) ?? "") : "",
            c.registered ? (ratio(c.spend, c.impressions, 1000) ?? "") : "",
          ]),
        ];
      if (tab === "budgets")
        rows = [
          [
            "Campaign",
            "Lifetime budget ZAR",
            "Lifetime recorded spend ZAR",
            "Lifetime remaining ZAR",
            "Spend through reporting end ZAR",
            "Scheduled budget through reporting end ZAR",
          ],
          ...analysis.budgets.map((c) => [
            c.name,
            c.budget,
            c.lifetimeSpend,
            c.remaining,
            c.spendToCutoff,
            c.expectedToDate ?? "",
          ]),
        ];
      if (tab === "placements")
        rows = [
          ["Placement", "Campaign", "Landing page", "Enquiries", "Move-ins"],
          ...analysis.placements.map((p) => [
            p.label,
            p.campaignName,
            p.landingPage,
            p.leads,
            p.won,
          ]),
        ];
      if (tab === "calendar" || tab === "activity")
        rows = [
          [
            "SAST day",
            "Campaign",
            "Activity",
            "Type",
            "Recorded spend ZAR",
            "Recorded clicks",
            "Recorded impressions",
          ],
          ...activities.map((a) => [
            southAfricaDateKey(new Date(a.occurredAt)),
            a.campaignName,
            a.title,
            a.kind,
            a.spend,
            a.clicks,
            a.impressions,
          ]),
        ];
      if (tab === "tracked links")
        rows = [
          ["Campaign", "Placement", "Landing page", "Tracking URL"],
          ...campaigns.flatMap((c) =>
            c.links.map((l) => [c.name, l.label, l.landingPage, l.url]),
          ),
        ];
    }
    try { await auditedCsvDownload({ kind: "marketing", rows, filename: `stor24-marketing-${tab.replaceAll(" ", "-")}-${from}-${to}.csv`, from, to, ...(facility ? { facilityId: facility } : {}) }); }
    catch (e) { setError(e instanceof Error ? e.message : "Export unavailable."); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const fields = new FormData(event.currentTarget),
        v = (key: string) => String(fields.get(key) || "");
      const payload =
        modal === "campaign"
          ? {
              kind: modal,
              submissionId,
              facilityId: v("facilityId"),
              name: v("name"),
              source: v("source"),
              medium: v("medium"),
              budget: Number(v("budget")),
              status: v("status"),
              startsAt: new Date(
                v("startsAt") + "T00:00:00+02:00",
              ).toISOString(),
              endsAt: v("endsAt")
                ? new Date(v("endsAt") + "T23:59:59+02:00").toISOString()
                : null,
            }
          : modal === "link"
            ? {
                kind: modal,
                submissionId,
                campaignId: v("campaignId"),
                label: v("label"),
                landingPage: v("landingPage"),
                keyword: v("keyword"),
              }
            : {
                kind: modal,
                submissionId,
                campaignId: v("campaignId"),
                title: v("title"),
                activityKind: v("activityKind"),
                occurredAt: new Date(
                  v("occurredAt") + "T12:00:00+02:00",
                ).toISOString(),
                spend: Number(v("spend")),
                impressions: Number(v("impressions")),
                clicks: Number(v("clicks")),
                notes: v("notes"),
              };
      const res = await fetch("/api/v1/marketing", {
        method: editingCampaign || editingActivity ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingCampaign
            ? {
                campaignId: editingCampaign.id,
                version: editingCampaign.version,
                name: v("name"),
                budget: Number(v("budget")),
                status: v("status"),
                startsAt: new Date(
                  v("startsAt") + "T00:00:00+02:00",
                ).toISOString(),
                endsAt: v("endsAt")
                  ? new Date(v("endsAt") + "T23:59:59+02:00").toISOString()
                  : null,
              }
            : editingActivity
              ? {
                  activityId: editingActivity.id,
                  version: editingActivity.version,
                  title: v("title"),
                  activityKind: v("activityKind"),
                  occurredAt: new Date(
                    v("occurredAt") + "T12:00:00+02:00",
                  ).toISOString(),
                  spend: Number(v("spend")),
                  impressions: Number(v("impressions")),
                  clicks: Number(v("clicks")),
                  notes: v("notes"),
                }
              : payload,
        ),
      });
      const body = await res.json();
      if (!res.ok)
        throw Error(body.error?.message || "Unable to save. Please retry.");
      setModal(null);
      await load();
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : "Unable to save. Your entries are retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  const max = Math.max(1, ...(report?.trend.map((d) => d.leads) ?? []));
  return (
    <div className="marketing-workspace">
      <header className="marketing-heading">
        <div>
          <p className="marketing-eyebrow">GROWTH &amp; ACQUISITION</p>
          <h1>Marketing command centre</h1>
          <p>
            Plan campaigns. Track every channel. See what brings customers
            through the door.
          </p>
        </div>
        <div className="marketing-actions">
          <button
            className="button button-secondary"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh marketing"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="button button-secondary"
            onClick={exportCsv}
            disabled={!report || loading}
          >
            <Download size={16} />
            Export
          </button>
          {canManage && (
            <button
              className="button button-primary"
              onClick={() => {
                setFormError("");
                openModal("campaign");
              }}
            >
              <Plus size={16} />
              New campaign
            </button>
          )}
        </div>
      </header>
      <div className="marketing-filters">
        <label>
          Reporting period
          <input
            type="date"
            value={from}
            max={to}
            min={southAfricaDateKey(
              new Date(
                new Date(to + "T12:00:00+02:00").getTime() - 365 * 86400000,
              ),
            )}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </label>
        <label>
          Store
          <select
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
          >
            <option value="">All permitted stores</option>
            {data?.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="marketing-period-presets"
          aria-label="Quick reporting periods"
        >
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => {
                setTo(today);
                setFrom(
                  southAfricaDateKey(
                    new Date(
                      new Date(today + "T12:00:00+02:00").getTime() -
                        (days - 1) * 86400000,
                    ),
                  ),
                );
              }}
            >
              {days} days
            </button>
          ))}
        </div>
        <span>South African time · ZAR</span>
      </div>
      {error ? (
        <div className="marketing-notice" role="alert">
          {error} <button onClick={() => void load()}>Retry</button>
        </div>
      ) : loading ? (
        <p role="status">Loading marketing results…</p>
      ) : null}
      {data?.limited && (
        <p className="marketing-notice">
          Results cover the latest 20,000 of {data.count.toLocaleString()}{" "}
          enquiries. Earlier records are excluded.
        </p>
      )}
      {report && (
        <>
          <div className="marketing-kpis">
            {[
              {
                title: "Enquiries",
                value: report.leads.toLocaleString(),
                detail: `${report.attributed} consented website journeys`,
                icon: Target,
              },
              {
                title: "Moved in",
                value: report.won.toLocaleString(),
                detail: `${report.conversion.toFixed(1)}% of enquiries · ${report.reserved} reserved`,
                icon: ArrowUpRight,
              },
              {
                title: "Recorded spend",
                value: money(report.spend),
                detail: "Activity entries in this period",
                icon: Wallet,
              },
              {
                title: "Recorded clicks",
                value: report.clicks.toLocaleString(),
                detail: `${report.impressions.toLocaleString()} recorded impressions`,
                icon: MousePointer2,
              },
            ].map((k) => (
              <article key={k.title}>
                <k.icon size={19} />
                <span>{k.title}</span>
                <strong>{k.value}</strong>
                <small>{k.detail}</small>
              </article>
            ))}
          </div>
          <nav className="marketing-tabs" aria-label="Marketing views">
            {[
              "overview",
              "abc insights",
              "channels",
              "budgets",
              "placements",
              "calendar",
              "campaigns",
              "tracked links",
              "activity",
            ].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {(tab === "overview" || tab === "abc insights") && <MarketingABCPanel key={`abc-${from}-${to}-${reportVersion}`} from={from} to={to} campaignNames={Object.fromEntries((data?.campaigns ?? []).map(c => [c.id,c.name]))} />}
          {data && (
            <MarketingCommandCentre
              data={data}
              from={from}
              to={to}
              facility={facility}
              view={tab}
            />
          )}
          {tab === "overview" && (
            <>
              <div className="marketing-provider-grid"><MarketingTrafficChart key={`${from}-${to}-${reportVersion}`} from={from} to={to} /><MarketingSearchConsole key={`search-${from}-${to}-${reportVersion}`} from={from} to={to}/></div>
              <MarketingAdvertising key={`ads-${from}-${to}-${reportVersion}`} from={from} to={to} />
              <MarketingOutcomes report={report} />
              <div className="marketing-chart-grid">
                <section className="marketing-card">
                  <div className="marketing-card-title">
                    <div>
                      <h2>Enquiry momentum</h2>
                      <p>Enquiries created in the selected period</p>
                    </div>
                    <BarChart3 size={20} />
                  </div>
                  {report.leads ? (
                    <>
                      <svg
                        viewBox="0 0 700 220"
                        role="img"
                        aria-label={`Enquiry trend, ${report.leads} enquiries. Daily values follow in the chart table.`}
                        className="marketing-trend"
                      >
                        <defs>
                          <linearGradient
                            id="marketing-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#ff5a0a"
                              stopOpacity=".22"
                            />
                            <stop
                              offset="100%"
                              stopColor="#ff5a0a"
                              stopOpacity="0"
                            />
                          </linearGradient>
                        </defs>
                        {[0, 1, 2, 3].map((i) => (
                          <g key={i}>
                            <line
                              x1="30"
                              x2="690"
                              y1={20 + i * 55}
                              y2={20 + i * 55}
                              stroke="#e2e9ed"
                            />
                            <text
                              x="0"
                              y={25 + i * 55}
                              fill="#687f8b"
                              fontSize="12"
                            >
                              {Math.round((max * (3 - i)) / 3)}
                            </text>
                          </g>
                        ))}
                        <path
                          d={`M30,185 ${report.trend.map((d, i) => `L${30 + (i * 660) / Math.max(1, report.trend.length - 1)},${185 - (d.leads / max) * 165}`).join(" ")} L690,185 Z`}
                          fill="url(#marketing-fill)"
                        />
                        <polyline
                          points={report.trend
                            .map(
                              (d, i) =>
                                `${30 + (i * 660) / Math.max(1, report.trend.length - 1)},${185 - (d.leads / max) * 165}`,
                            )
                            .join(" ")}
                          fill="none"
                          stroke="#ff5a0a"
                          strokeWidth="3"
                          strokeLinejoin="round"
                        />
                        <text x="30" y="213" fill="#687f8b" fontSize="12">
                          {date(from)}
                        </text>
                        <text
                          x="690"
                          y="213"
                          textAnchor="end"
                          fill="#687f8b"
                          fontSize="12"
                        >
                          {date(to)}
                        </text>
                      </svg>
                      <details className="marketing-chart-values">
                        <summary>View chart values</summary>
                        <div className="marketing-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Date / week starting</th>
                                <th>Enquiries</th>
                                <th>Recorded spend</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.trend.map((d) => (
                                <tr key={d.date}>
                                  <td>{d.date}</td>
                                  <td>{d.leads}</td>
                                  <td>{money(d.spend)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  ) : (
                    <div className="marketing-empty">
                      No enquiries in this period. Results will appear as
                      enquiries arrive.
                    </div>
                  )}
                </section>
                <section className="marketing-card">
                  <h2>Acquisition channels</h2>
                  <p>Website attribution and recorded sources stay distinct</p>
                  <div className="marketing-channel-bars">
                    {report.channels.slice(0, 8).map((c) => (
                      <div key={c.label}>
                        <span>{c.label}</span>
                        <strong>{c.leads}</strong>
                        <div>
                          <i
                            style={{
                              width: `${(c.leads / Math.max(1, ...report.channels.map((s) => s.leads))) * 100}%`,
                            }}
                          />
                        </div>
                        <small>{c.won} moved in</small>
                      </div>
                    ))}
                    {!report.channels.length && (
                      <p className="marketing-empty">
                        No channel data in this period.
                      </p>
                    )}
                  </div>
                </section>
              </div>
              <div className="marketing-chart-grid">
                <section className="marketing-card">
                  <h2>Attribution coverage</h2>
                  <p>Consented website journeys linked to enquiries</p>
                  <div className="marketing-coverage">
                    <strong>
                      {report.leads
                        ? Math.round((report.attributed / report.leads) * 100)
                        : 0}
                      %
                    </strong>
                    <div>
                      <b>{report.attributed} attributed</b>
                      <p>
                        {report.unknown} recorded-source or unattributed
                        enquiries
                      </p>
                    </div>
                  </div>
                  <p>
                    Rejected consent and historical enquiries remain
                    unattributed. This is enquiry-to-move-in conversion, not a
                    website visitor conversion rate.
                  </p>
                </section>
                <section className="marketing-card">
                  <h2>Measurement connections</h2>
                  <div className="marketing-connection">
                    <span className="marketing-dot" />
                    <div>
                      <b>CRM enquiries &amp; move-ins</b>
                      <p>Live, scoped operational results</p>
                    </div>
                  </div>
                  <div className="marketing-connection">
                    <span className="marketing-dot" />
                    <div>
                      <b>Campaign UTMs</b>
                      <p>
                        Registered links, consented first session attribution
                      </p>
                    </div>
                  </div>
                  <div className="marketing-connection">
                    <span className="marketing-dot marketing-dot-manual" />
                    <div>
                      <b>Ad spend, clicks &amp; impressions</b>
                      <p>
                        Recorded activity figures; live provider reports appear above
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://analytics.google.com/analytics/web/#/p556793224/reports/intelligenthome"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="marketing-external"
                  >
                    Open STOR24 Google Analytics <ArrowUpRight size={16} />
                  </a>
                </section>
              </div>
            </>
          )}
          {tab === "campaigns" && (
            <section className="marketing-card">
              <div className="marketing-card-title">
                <div>
                  <h2>Campaign results</h2>
                  <p>
                    Enquiry cohort outcomes and spend recorded during this
                    period
                  </p>
                </div>
              </div>
              <div className="marketing-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Campaign",
                        "Channel",
                        "Status",
                        "Budget",
                        "Spend",
                        "Enquiries",
                        "Moved in",
                        "Cost / enquiry",
                        "Cost / move-in",
                        ...(canManage ? ["Actions"] : []),
                      ].map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>
                          {c.source}
                          <small>{c.medium}</small>
                        </td>
                        <td>
                          <span className="marketing-status">
                            {c.status.toLowerCase()}
                          </span>
                        </td>
                        <td>{money(c.budget)}</td>
                        <td>{money(c.spend)}</td>
                        <td>{c.leads}</td>
                        <td>{c.won}</td>
                        <td>{c.cpl === null ? "—" : money(c.cpl)}</td>
                        <td>{c.cac === null ? "—" : money(c.cac)}</td>
                        {canManage && (
                          <td>
                            <button
                              className="marketing-edit"
                              onClick={() => {
                                const record = campaigns.find(
                                  (row) => row.id === c.id,
                                );
                                if (record) {
                                  openModal("campaign");
                                  setEditingCampaign(record);
                                }
                              }}
                            >
                              Edit campaign
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!campaigns.length && (
                <div className="marketing-empty">
                  Create your first campaign to organise activity and measure
                  its results.
                </div>
              )}
            </section>
          )}
          {tab === "tracked links" && (
            <section className="marketing-card">
              <div className="marketing-card-title">
                <div>
                  <h2>Tracked campaign links</h2>
                  <p>
                    Use these URLs in ads, social posts, email and QR codes.
                  </p>
                </div>
                {canManage && (
                  <button
                    className="button button-primary"
                    disabled={!campaigns.length}
                    onClick={() => {
                      setFormError("");
                      openModal("link");
                    }}
                  >
                    <LinkIcon size={16} />
                    Create link
                  </button>
                )}
              </div>
              {campaigns.flatMap((c) =>
                c.links.map((l) => (
                  <article className="marketing-link" key={l.id}>
                    <div>
                      <strong>{l.label}</strong>
                      <small>
                        {c.name} · {l.landingPage}
                        {l.keyword ? ` · keyword: ${l.keyword}` : ""} ·{" "}
                        {
                          (data?.leads ?? []).filter(
                            (lead) =>
                              lead.attribution?.linkId === l.id &&
                              southAfricaDateKey(new Date(lead.createdAt)) >=
                                from &&
                              southAfricaDateKey(new Date(lead.createdAt)) <=
                                to,
                          ).length
                        }{" "}
                        enquiries
                      </small>
                      <code>{l.url}</code>
                    </div>
                    <button
                      className="button button-secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(l.url);
                          setCopied(l.id);
                        } catch {
                          setError(
                            "Copy unavailable. Select and copy the displayed URL.",
                          );
                        }
                      }}
                    >
                      {copied === l.id ? "Copied" : "Copy link"}
                    </button>
                  </article>
                )),
              )}
              {!campaigns.some((c) => c.links.length) && (
                <div className="marketing-empty">
                  No tracked links yet. Create a campaign, then add a link for
                  each placement or creative.
                </div>
              )}
            </section>
          )}
          {tab === "activity" && (
            <section className="marketing-card">
              <div className="marketing-card-title">
                <div>
                  <h2>Marketing activity</h2>
                  <p>
                    Record online and offline work, spend and platform results.
                  </p>
                </div>
                {canManage && (
                  <button
                    className="button button-primary"
                    disabled={!campaigns.length}
                    onClick={() => {
                      setFormError("");
                      openModal("activity");
                    }}
                  >
                    <Plus size={16} />
                    Log activity
                  </button>
                )}
              </div>
              <div className="marketing-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Date",
                        "Activity",
                        "Campaign",
                        "Type",
                        "Spend",
                        "Impressions",
                        "Clicks",
                        ...(canManage ? ["Actions"] : []),
                      ].map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a) => (
                      <tr key={a.id}>
                        <td>{date(a.occurredAt)}</td>
                        <td>
                          <strong>{a.title}</strong>
                          {a.notes && <small>{a.notes}</small>}
                        </td>
                        <td>{a.campaignName}</td>
                        <td>{a.kind.toLowerCase()}</td>
                        <td>{money(a.spend)}</td>
                        <td>{a.impressions.toLocaleString()}</td>
                        <td>{a.clicks.toLocaleString()}</td>
                        {canManage && (
                          <td>
                            <button
                              className="marketing-edit"
                              onClick={() => {
                                openModal("activity");
                                setEditingActivity(a);
                              }}
                            >
                              Edit activity
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!activities.length && (
                <div className="marketing-empty">
                  No activity recorded in this period.
                </div>
              )}
            </section>
          )}
        </>
      )}
      {modal && (
        <MarketingDialog busy={busy} onClose={() => setModal(null)}>
          <button
            className="modal-close"
            aria-label="Close marketing form"
            disabled={busy}
            onClick={() => setModal(null)}
          >
            <X size={18} />
          </button>
          <p className="marketing-eyebrow">MARKETING WORKSPACE</p>
          <h2 id="marketing-form-title">
            {modal === "campaign"
              ? editingCampaign
                ? "Edit campaign"
                : "New campaign"
              : modal === "link"
                ? "Create tracked link"
                : editingActivity
                  ? "Edit activity"
                  : "Log marketing activity"}
          </h2>
          <form onSubmit={save}>
            {modal === "campaign" ? (
              <>
                <label>
                  Campaign name
                  <input
                    autoFocus
                    name="name"
                    defaultValue={editingCampaign?.name}
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="Midpoint launch — Google search"
                  />
                </label>
                <label>
                  Store
                  <select
                    name="facilityId"
                    required
                    disabled={Boolean(editingCampaign)}
                    defaultValue={
                      editingCampaign?.facilityId ||
                      facility ||
                      data?.facilities[0]?.id
                    }
                  >
                    {data?.facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="marketing-form-row">
                  <label>
                    Source
                    <select
                      name="source"
                      disabled={Boolean(editingCampaign)}
                      defaultValue={editingCampaign?.source}
                    >
                      {marketingSources.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Medium
                    <select
                      name="medium"
                      disabled={Boolean(editingCampaign)}
                      defaultValue={editingCampaign?.medium}
                    >
                      {marketingMedia.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="marketing-form-row">
                  <label>
                    Budget (ZAR)
                    <input
                      name="budget"
                      type="number"
                      min="0"
                      step=".01"
                      defaultValue={editingCampaign?.budget ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Status
                    <select
                      name="status"
                      defaultValue={editingCampaign?.status}
                    >
                      {["PLANNED", "ACTIVE", "PAUSED", "COMPLETE"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="marketing-form-row">
                  <label>
                    Starts
                    <input
                      name="startsAt"
                      type="date"
                      defaultValue={
                        editingCampaign
                          ? southAfricaDateKey(
                              new Date(editingCampaign.startsAt),
                            )
                          : today
                      }
                      required
                    />
                  </label>
                  <label>
                    Ends (optional)
                    <input
                      name="endsAt"
                      type="date"
                      defaultValue={
                        editingCampaign?.endsAt
                          ? southAfricaDateKey(new Date(editingCampaign.endsAt))
                          : ""
                      }
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <label>
                  Campaign
                  <select
                    autoFocus
                    name="campaignId"
                    required
                    disabled={Boolean(editingActivity)}
                    defaultValue={editingActivity?.campaignId}
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {modal === "link" ? (
                  <>
                    <label>
                      Placement / creative name
                      <input
                        name="label"
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="Instagram launch reel"
                      />
                    </label>
                    <label>
                      Landing page
                      <select name="landingPage">
                        {[
                          "/",
                          "/book",
                          "/contact",
                          "/space-guide",
                          "/storage/midpoint",
                          "/storage/melrose",
                          "/personal-storage",
                          "/business-storage",
                          "/student-storage",
                          "/moving-storage",
                          "/storage-unit-sizes",
                          "/storage-insights",
                          "/blog",
                        ].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Keyword label (optional, internal)
                      <input
                        name="keyword"
                        maxLength={100}
                        placeholder="storage midrand"
                      />
                    </label>
                    <p className="marketing-form-note">
                      The link carries registered campaign and creative IDs.
                      Names and keyword text stay inside this workspace. Do not
                      add customer details.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Activity title
                      <input
                        name="title"
                        defaultValue={editingActivity?.title}
                        required
                        minLength={2}
                        maxLength={100}
                      />
                    </label>
                    <div className="marketing-form-row">
                      <label>
                        Type
                        <select
                          name="activityKind"
                          defaultValue={editingActivity?.kind}
                        >
                          {[
                            "ADVERTISING",
                            "SOCIAL",
                            "EMAIL",
                            "EVENT",
                            "PRINT",
                            "PARTNERSHIP",
                            "CONTENT",
                            "OTHER",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Date
                        <input
                          name="occurredAt"
                          type="date"
                          max={today}
                          defaultValue={
                            editingActivity
                              ? southAfricaDateKey(
                                  new Date(editingActivity.occurredAt),
                                )
                              : today
                          }
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Spend (ZAR)
                      <input
                        name="spend"
                        type="number"
                        min="0"
                        step=".01"
                        required
                        defaultValue={editingActivity?.spend ?? 0}
                      />
                    </label>
                    <div className="marketing-form-row">
                      <label>
                        Impressions
                        <input
                          name="impressions"
                          type="number"
                          min="0"
                          step="1"
                          required
                          defaultValue={editingActivity?.impressions ?? 0}
                        />
                      </label>
                      <label>
                        Clicks
                        <input
                          name="clicks"
                          type="number"
                          min="0"
                          step="1"
                          required
                          defaultValue={editingActivity?.clicks ?? 0}
                        />
                      </label>
                    </div>
                    <label>
                      Notes (optional)
                      <textarea
                        name="notes"
                        maxLength={1000}
                        rows={3}
                        defaultValue={editingActivity?.notes ?? ""}
                      />
                    </label>
                    <p className="marketing-form-note">
                      Enter non-overlapping activity totals to avoid counting
                      the same platform results twice.
                    </p>
                  </>
                )}
              </>
            )}
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
            <div className="marketing-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </MarketingDialog>
      )}
    </div>
  );
}
