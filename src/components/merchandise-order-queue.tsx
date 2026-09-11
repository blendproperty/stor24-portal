"use client";
import { useCallback, useEffect, useState } from "react";

type Order = { id: string; status: string; total: string; currency: string; items: { name: string; quantity: number }[]; account: { accountNumber: string; customer: { firstName: string; lastName: string; companyName: string | null } } };
export function MerchandiseOrderQueue() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/v1/operations/merchandise-orders", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Orders unavailable.");
    setOrders(body.data);
  }, []);
  useEffect(() => { void refresh().catch(error => setMessage(error.message)); }, [refresh]);
  async function fulfil(id: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/operations/merchandise-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "fulfil" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Order could not be fulfilled.");
      setConfirming(null); setMessage("Supply recorded. Stock has been updated.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please refresh before retrying."); }
    finally { setBusy(false); }
  }
  return <section><h2>Paid packing supplies</h2><p>Confirm collection or delivery only after handing over the listed items. Orders needing payment review cannot be supplied here.</p><p role="status">{message}</p>{!orders.length && <p>No orders to display.</p>}{orders.map(order => <article key={order.id} className="tenant-card"><h3>{order.account.customer.companyName || `${order.account.customer.firstName} ${order.account.customer.lastName}`}</h3><p>{order.account.accountNumber} · {new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))}</p><p>{order.status === "PAID" ? "Paid · awaiting supply" : order.status === "FULFILLED" ? "Supplied" : "Payment review — do not supply"}</p><ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul>{order.status === "PAID" && (confirming === order.id ? <div><p>Have all these items been handed over? This will deduct them from stock.</p><button disabled={busy} onClick={() => void fulfil(order.id)}>Confirm supplied</button><button disabled={busy} onClick={() => setConfirming(null)}>Not yet</button></div> : <button disabled={busy} onClick={() => setConfirming(order.id)}>Record collection / delivery</button>)}</article>)}</section>;
}
