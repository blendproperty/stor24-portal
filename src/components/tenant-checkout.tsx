"use client";
import { useRef, useState } from "react";

export function TenantCheckout({ unitKey, items, disabled = false }: { unitKey: string; items: { productId: string; quantity: number }[]; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const attempt = useRef<{ basket: string; key: string } | null>(null);
  const sending = useRef(false);
  async function checkout() {
    if (sending.current || disabled || !items.length || orderId) return;
    sending.current = true; setBusy(true); setMessage("");
    const basket = JSON.stringify({ unitKey, items });
    if (attempt.current?.basket !== basket) attempt.current = { basket, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/tenant/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit: unitKey, items, idempotencyKey: attempt.current.key }) });
      const body = await response.json();
      if (body.data?.orderId) setOrderId(body.data.orderId);
      if (!response.ok) throw new Error(body.error || "Checkout could not be opened.");
      const formData = body.data.checkout;
      if (formData.actionUrl !== "https://paynow.netcash.co.za/site/paynow.aspx" || formData.method !== "POST") throw new Error("Payment destination could not be verified.");
      const form = document.createElement("form");
      form.method = "POST"; form.action = formData.actionUrl; form.target = "_top";
      for (const [name, value] of Object.entries(formData.fields)) {
        if (typeof value !== "string") throw new Error("Payment details could not be read.");
        const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
      }
      document.body.appendChild(form); form.submit(); form.remove();
      setMessage("Opening secure payment. Your order is not paid until payment is confirmed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }
  async function recover(cancel: boolean) {
    if (!orderId || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/tenant/orders/${encodeURIComponent(orderId)}`, { method: cancel ? "DELETE" : "GET", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || "Order unavailable.");
      const labels: Record<string, string> = { AWAITING_PAYMENT: "Awaiting payment confirmation", PAID: "Paid · awaiting supply", FULFILLED: "Collected / supplied", PAYMENT_REVIEW: "Payment received · your store is reviewing it", CANCELLED: "Cancelled", EXPIRED: "Expired" };
      setMessage(body.message || labels[body.data.status] || "Please contact your store.");
      if (["CANCELLED", "EXPIRED"].includes(body.data.status)) { setOrderId(null); attempt.current = null; }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Order unavailable."); }
    finally { sending.current = false; setBusy(false); }
  }
  return <div><button className="tenant-primary" disabled={disabled || busy || !items.length || !!orderId} onClick={() => void checkout()}>{busy ? "Please wait…" : "Continue to secure payment →"}</button>{orderId && <div><button disabled={busy} onClick={() => void recover(false)}>Check payment status</button><button disabled={busy} onClick={() => void recover(true)}>Cancel unpaid order</button></div>}{message && <p role="status">{message}</p>}</div>;
}
