"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type Order = { isTest?: boolean; testSucceeded?: boolean; receiptId?: string | null; status: string; total: string; currency: string; items: { name: string; quantity: number }[] };
const labels: Record<string, string> = {
  AWAITING_PAYMENT: "Waiting for payment confirmation",
  PAID: "Paid. Your supplies are awaiting handover.",
  FULFILLED: "Your supplies have been collected or supplied.",
  PAYMENT_REVIEW: "Payment received. Your store is reviewing this order.",
  CANCELLED: "This order was cancelled.", EXPIRED: "This unpaid order has expired.",
};
export function TenantOrderStatus({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const testMessage = order?.testSucceeded ? "R10 test confirmed. This did not purchase the merchandise or change your balance." : order?.isTest ? "R10 checkout test — not a merchandise purchase. Waiting for provider confirmation; a return page alone does not confirm the test." : null;
  async function cancel() {
    if (busy || order?.status !== "AWAITING_PAYMENT") return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tenant/orders/${encodeURIComponent(orderId)}`, { method: "DELETE", cache: "no-store" });
      const body = await response.json();
      if (body.data?.status) setOrder(current => current ? { ...current, status: body.data.status } : null);
      if (!response.ok) throw new Error(body.message || body.error || "Cancellation could not be confirmed. Refresh the order before trying again.");
      setMessage(body.message); setConfirmCancel(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please refresh the order."); }
    finally { setBusy(false); }
  }
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
  return <div className="tenant-portal"><header className="tenant-header"><Image src="/brand/stor24-logo-official-email-20260909.svg" width={183} height={48} alt="STOR24" priority unoptimized /><span>MY STOR24</span></header><main className="tenant-body"><section className="tenant-card"><span className="tenant-eyebrow">MY STOR24 · PACKING SUPPLIES</span><h1>Your order</h1>{order && <><h2>{testMessage || labels[order.status] || "Contact your store about this order."}</h2><p>{new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))}</p><ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul></>}<p role="status">{busy ? "Checking your order…" : message}</p><button className="tenant-primary" disabled={busy} onClick={() => void refresh()}>Refresh order status</button>{order?.status === "AWAITING_PAYMENT" && <div>{confirmCancel ? <><p>Cancel this unpaid order and release its reserved stock? Any payment already in progress will be reviewed if it arrives.</p><button disabled={busy} onClick={() => void cancel()}>Confirm cancellation</button><button disabled={busy} onClick={() => setConfirmCancel(false)}>Keep order</button></> : <button disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel unpaid order</button>}</div>}{order?.receiptId && <div className="tenant-downloads"><a href={`/api/tenant/documents/receipt/${encodeURIComponent(order.receiptId)}`}>Download payment receipt ↓</a></div>}<p><a href="/my">Back to My STOR24 / sign in →</a></p><small>Payment status is confirmed by STOR24, not by the payment return screen. Do not pay again while confirmation is pending.</small></section></main></div>;
}
