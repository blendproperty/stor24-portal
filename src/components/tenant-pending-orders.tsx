"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type PendingOrder = { id: string; status: string; total: string; currency: string };
export function TenantPendingOrders({ accountId, unitId }: { accountId: string; unitId: string }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tenant/orders/pending?account=${encodeURIComponent(accountId)}&unit=${encodeURIComponent(unitId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Pending orders unavailable."); return body.data; })
      .then(data => { if (!controller.signal.aborted) setOrders(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [accountId, unitId]);
  if (error) return <p role="alert">{error} Please check existing orders before paying again.</p>;
  if (!orders.length) return null;
  return <aside><h3>Orders awaiting confirmation</h3><p>These are not completed purchases. Check an existing order before paying again.</p>{orders.map(order => <p key={order.id}><Link href={`/my/orders/${encodeURIComponent(order.id)}`}>{order.status === "PAYMENT_REVIEW" ? "Payment received · store review" : "Awaiting payment confirmation"} · {new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))} →</Link></p>)}</aside>;
}
