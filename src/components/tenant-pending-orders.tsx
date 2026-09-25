"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type PendingOrder = { id: string; status: string; total: string; currency: string };
export function TenantPendingOrders({ accountId, unitId }: { accountId: string; unitId: string }) {
  const scope = JSON.stringify([accountId, unitId]);
  const [result, setResult] = useState<{ scope: string; orders: PendingOrder[]; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    fetch(`/api/tenant/orders/pending?account=${encodeURIComponent(accountId)}&unit=${encodeURIComponent(unitId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !Array.isArray(body.data)) throw new Error("PENDING_ORDERS_UNAVAILABLE"); return body.data; })
      .then(orders => { if (active && !controller.signal.aborted) setResult({ scope, orders, error: "" }); })
      .catch(() => { if (active) setResult({ scope, orders: [], error: "We could not check your pending orders." }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [accountId, unitId, scope, attempt]);
  if (!result || result.scope !== scope) return <p role="status">Checking pending orders. Please wait before starting another payment.</p>;
  const { orders, error } = result;
  if (error) return <aside><p role="alert">{error} Please check existing orders before paying again.</p><button className="tenant-secondary" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Retry order check</button></aside>;
  if (!orders.length) return null;
  return <aside><h3>Orders awaiting confirmation</h3><p>These are not completed purchases. Check an existing order before paying again.</p>{orders.map(order => <p key={order.id}><Link href={`/my/orders/${encodeURIComponent(order.id)}`}>{order.status === "PAYMENT_REVIEW" ? "Payment received · store review" : "Awaiting payment confirmation"} · {new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))} →</Link></p>)}</aside>;
}
