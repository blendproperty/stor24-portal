"use client";
import { useCallback, useEffect, useState } from "react";

type Order = { status: string; total: string; currency: string; items: { name: string; quantity: number }[] };
const labels: Record<string, string> = {
  AWAITING_PAYMENT: "Waiting for payment confirmation",
  PAID: "Paid. Your packing supplies are being prepared.",
  FULFILLED: "Your supplies have been collected or supplied.",
  PAYMENT_REVIEW: "Payment received. Your store is reviewing this order.",
  CANCELLED: "This order was cancelled.", EXPIRED: "This unpaid order has expired.",
};
export function TenantOrderStatus({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const refresh = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/tenant/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) { setOrder(null); throw new Error(body.error || "Order unavailable."); }
      setOrder(body.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Order unavailable."); }
    finally { setBusy(false); }
  }, [orderId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tenant/orders/${encodeURIComponent(orderId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Order unavailable."); return body.data; })
      .then(data => { if (!controller.signal.aborted) setOrder(data); })
      .catch(error => { if (!controller.signal.aborted) { setOrder(null); setMessage(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [orderId]);
  return <main className="tenant-shell"><section className="tenant-card"><span className="tenant-eyebrow">MY STOR24 · PACKING SUPPLIES</span><h1>Your order</h1>{order && <><h2>{labels[order.status] || "Contact your store about this order."}</h2><p>{new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))}</p><ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul></>}<p role="status">{busy ? "Checking your order…" : message}</p><button disabled={busy} onClick={() => void refresh()}>Refresh order status</button><p><a href="/my">Back to My STOR24 / sign in →</a></p><small>Payment status is confirmed by STOR24, not by the payment return screen. Do not pay again while confirmation is pending.</small></section></main>;
}
