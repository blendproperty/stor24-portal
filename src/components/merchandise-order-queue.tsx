"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

type Order = { id: string; status: string; total: string; currency: string; items: { name: string; quantity: number }[]; account: { accountNumber: string; customer: { firstName: string; lastName: string; companyName: string | null } } };
const ordersSchema = z.array(z.object({
  id: z.string().min(1), status: z.enum(["PAID", "PAYMENT_REVIEW", "FULFILLED"]),
  total: z.string().regex(/^\d+(\.\d+)?$/).refine(value => Number.isFinite(Number(value))), currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive() })),
  account: z.object({ accountNumber: z.string(), customer: z.object({ firstName: z.string().nullable().transform(value => value ?? ""), lastName: z.string().nullable().transform(value => value ?? ""), companyName: z.string().nullable() }) }),
}));
export function MerchandiseOrderQueue() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const uncertain = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [supplyError, setSupplyError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  const readController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true); setReadError("");
    try {
      const response = await fetch("/api/v1/operations/merchandise-orders", { cache: "no-store", signal: controller.signal });
      if (readController.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        setOrders([]); setLoaded(false); setConfirming(null);
        setReadError(response.status === 403 ? "You do not have access to these orders. Please contact your administrator." : "Your session has expired. Please sign in again.");
        return;
      }
      if (!response.ok) throw new Error("READ_FAILED");
      const body = await response.json();
      const data = ordersSchema.parse(body.data);
      if (readController.current !== controller) return;
      setOrders(data); setLoaded(true);
      if (uncertain.current) {
        uncertain.current = false; setBlocked(false); setConfirming(null); setSupplyError("");
        setMessage("Orders refreshed. Check the current supply status before taking further action.");
      }
    } catch {
      if (readController.current === controller) setReadError("Orders could not be loaded. Refresh orders to try again before recording supply.");
    } finally {
      clearTimeout(timeout);
      if (readController.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initialLoad = setTimeout(() => { void refresh(); }, 0);
    return () => { clearTimeout(initialLoad); readController.current?.abort(); readController.current = null; };
  }, [refresh]);
  async function fulfil(id: string) {
    if (saving.current || uncertain.current || loading || readError || !loaded) return;
    saving.current = true;
    setBusy(true); setMessage(""); setSupplyError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/v1/operations/merchandise-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "fulfil" }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok && [400, 401, 403, 404, 409].includes(response.status)) {
        setSupplyError(typeof body.error?.message === "string" ? body.error.message : "Supply was not recorded. Check the order before retrying.");
        if (response.status === 401 || response.status === 403) {
          setOrders([]); setLoaded(false); setConfirming(null);
          setReadError(response.status === 403 ? "Please contact your administrator for access." : "Please sign in again.");
        }
        return;
      }
      if (!response.ok) throw new Error("UNCERTAIN");
      z.object({ id: z.literal(id), status: z.literal("FULFILLED"), fulfilledAt: z.string().datetime() }).parse(body.data);
      setOrders(current => current.map(order => order.id === id ? { ...order, status: "FULFILLED" } : order));
      setConfirming(null); setMessage("Supply recorded. Stock has been updated.");
      await refresh();
    } catch {
      uncertain.current = true; setBlocked(true);
      setSupplyError("We could not confirm whether supply was recorded. Refresh orders to check the saved status before trying again.");
    }
    finally { clearTimeout(timeout); saving.current = false; setBusy(false); }
  }
  return <section><h2>Paid packing supplies</h2><p>Confirm collection or delivery only after handing over the listed items. Orders needing payment review cannot be supplied here.</p><button disabled={loading || busy} onClick={() => void refresh()}>Refresh orders</button>{loading && <p role="status">Loading orders…</p>}{readError && <p role="alert">{readError}</p>}{supplyError && <p role="alert">{supplyError}</p>}{message && <p role="status">{message}</p>}{loaded && !loading && !readError && !orders.length && <p>No orders to display.</p>}{orders.map(order => <article key={order.id} className="tenant-card"><h3>{order.account.customer.companyName || `${order.account.customer.firstName} ${order.account.customer.lastName}`}</h3><p>{order.account.accountNumber} · {new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))}</p><p>{order.status === "PAID" ? "Paid · awaiting supply" : order.status === "FULFILLED" ? "Supplied" : "Payment review — do not supply"}</p><ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul>{order.status === "PAID" && (confirming === order.id ? <div><p>Have all these items been handed over? This will deduct them from stock.</p><button disabled={busy || loading || !!readError || blocked} onClick={() => void fulfil(order.id)}>Confirm supplied</button><button disabled={busy || loading || !!readError || blocked} onClick={() => setConfirming(null)}>Not yet</button></div> : <button disabled={busy || loading || !!readError || blocked} onClick={() => setConfirming(order.id)}>Record collection / delivery</button>)}</article>)}</section>;
}
