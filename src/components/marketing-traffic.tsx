"use client";
import { useEffect, useState } from "react";
import type { MarketingTraffic } from "@/lib/marketing-ga";
export function MarketingTrafficChart({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const [data, setData] = useState<MarketingTraffic | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/marketing/traffic?from=${from}&to=${to}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 403)
          throw Error(
            "Website-wide traffic is available to users with all-store reporting access.",
          );
        if (!res.ok) throw Error("Traffic could not load. Refresh to retry.");
        const body = await res.json();
        setData(body.data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [from, to]);
  const max = Math.max(1, ...(data?.days.map((d) => d.sessions) ?? []));
  return (
    <section className="marketing-card">
      <h2>Website traffic</h2>
      <p>{error || data?.message || "Loading website traffic…"}</p>
      {data?.totals && (
        <>
          <div className="marketing-traffic-totals">
            <div>
              <strong>{data.totals.sessions.toLocaleString()}</strong>
              <span>Sessions</span>
            </div>
            <div>
              <strong>{data.totals.users.toLocaleString()}</strong>
              <span>Users</span>
            </div>
            <div>
              <strong>{data.totals.views.toLocaleString()}</strong>
              <span>Page views</span>
            </div>
          </div>
          {data.days.length > 0 && (
            <svg
              className="marketing-trend"
              viewBox="0 0 700 160"
              role="img"
              aria-label={`Website sessions by day. ${data.totals.sessions} sessions. Values available below.`}
            >
              {[0, 1, 2].map((i) => (
                <line
                  key={i}
                  x1="0"
                  x2="700"
                  y1={10 + i * 60}
                  y2={10 + i * 60}
                  stroke="#e2e9ed"
                />
              ))}
              <polyline
                points={data.days
                  .map(
                    (d, i) =>
                      `${(i * 700) / Math.max(1, data.days.length - 1)},${140 - (d.sessions / max) * 130}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="#228b77"
                strokeWidth="3"
              />
            </svg>
          )}
          <details className="marketing-chart-values">
            <summary>View traffic values</summary>
            <div className="marketing-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sessions</th>
                    <th>Page views</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{d.sessions}</td>
                      <td>{d.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
