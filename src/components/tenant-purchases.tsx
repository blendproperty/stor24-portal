"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { TenantMerchandise } from "@/components/tenant-merchandise";
import { TenantPendingOrders } from "@/components/tenant-pending-orders";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";
import { packageItems } from "@/lib/tenant-merchandise";
export type BookingPackage = { id: string; publicReference: string | null; packageSelection: { packageName: string; status: string; priceSnapshot: string; itemsSnapshot: unknown; fulfilledAt: string | null } | null };
type Purchase = { id: string; unitId: string; status: string; total: string; currency: string; paymentId: string | null; createdAt: string; fulfilledAt: string | null; items: { name: string; quantity: number; unitPrice: string; product: { imageUrl: string | null } }[] };
type PurchaseProps = { unitKey: string; unitId: string; unitNumber: string; accountId: string | null; canShop: boolean; bookingPackages?: BookingPackage[]; hasTestPayment?: boolean };
export function TenantPurchases(props: PurchaseProps) {
  // Reset the whole purchase/basket state synchronously on unit/account changes.
  return <div key={`${props.unitKey}:${props.unitId}:${props.accountId ?? "none"}`}>
    {props.accountId && <TenantPendingOrders accountId={props.accountId} unitId={props.unitId} />}
    <UnitPurchases {...props} />
  </div>;
}
function UnitPurchases({ unitKey, unitId, unitNumber, accountId, canShop, bookingPackages = [], hasTestPayment = false }: PurchaseProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(!!accountId);
  const [error, setError] = useState("");
  const [shopping, setShopping] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    let disposed = false;
    const controller = new AbortController();
    fetch(`/api/tenant/orders?account=${encodeURIComponent(accountId)}&unit=${encodeURIComponent(unitId)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Your purchases could not be loaded.");
      if (!disposed) setPurchases(body.data.filter((order: Purchase) => order.unitId === unitId));
    }).catch(error => { if (!disposed) setError(error.message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); };
  }, [accountId, unitId, refresh]);
  return <section className="tenant-card"><span className="tenant-eyebrow">PACKED. SORTED. YOURS.</span><h2>Your packing supplies</h2><p>Booking packages and separate purchases for Unit {unitNumber}.</p>
    {bookingPackages.map(booking => booking.packageSelection && <article className="tenant-request" key={booking.id} aria-label={`Booking package ${booking.packageSelection.packageName}`}>
      <span className="tenant-eyebrow">Selected with your booking</span><h3>{booking.packageSelection.packageName}</h3>
      <p><strong>{new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(booking.packageSelection.priceSnapshot))}</strong> · {booking.publicReference}</p>
      <p>{booking.packageSelection.status === "FULFILLED" ? "Collected / supplied" : booking.packageSelection.status === "RESERVED" ? "Items reserved with your booking · awaiting supply" : booking.packageSelection.status === "RELEASED" ? "Reservation released · items are no longer held" : "Contact your store to confirm supply status"}</p>
      {hasTestPayment && booking.packageSelection.status === "RESERVED" && <p>Test payment recorded. This selection is saved, but a test payment does not pay for these supplies.</p>}
      {!hasTestPayment && booking.packageSelection.status === "RESERVED" && <p>This confirms your selection and stock reservation. Payment confirmation is shown separately.</p>}
      <ul>{packageItems(booking.packageSelection.itemsSnapshot).map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul>
      {booking.packageSelection.fulfilledAt && <p>Supplied {formatSouthAfricaDate(booking.packageSelection.fulfilledAt)}</p>}
    </article>)}
    <h3>Separate purchases</h3>{accountId && <button className="tenant-secondary" disabled={loading} onClick={() => { setError(""); setLoading(true); setRefresh(value => value + 1); }}>{loading ? "Checking purchases…" : "Refresh purchase status ↻"}</button>}{loading ? <p role="status">Loading your purchases…</p> : error ? <p role="alert">{error}</p> : purchases.length ? purchases.map(order => <article className="tenant-request" key={order.id}><strong>{new Intl.NumberFormat("en-ZA", { style: "currency", currency: order.currency }).format(Number(order.total))}</strong><p>{formatSouthAfricaDate(order.createdAt)} · {order.status === "FULFILLED" ? "Collected / supplied" : "Paid · awaiting supply"}</p><p className="tenant-purchase-status">{order.status === "FULFILLED" ? `All sorted — your store recorded these supplies as collected or supplied${order.fulfilledAt ? ` on ${formatSouthAfricaDate(order.fulfilledAt)}` : ""}.` : "Payment received. Your supplies are awaiting handover by the store."}</p>{order.items.map((item, index) => <div className="tenant-purchase-item" key={index}>{item.product.imageUrl && <Image src={item.product.imageUrl} width={64} height={64} alt={item.name} unoptimized />}<span>{item.quantity} × {item.name}</span></div>)}<div className="tenant-purchase-actions"><a href={`/my/orders/${encodeURIComponent(order.id)}`}>View order status →</a>{order.paymentId && <a href={`/api/tenant/documents/receipt/${encodeURIComponent(order.paymentId)}`}>Download receipt ↓</a>}</div></article>) : <p>No completed separate purchases for this unit. Any package selected with your booking is shown above.</p>}{canShop && <button className="tenant-primary" aria-expanded={shopping} onClick={() => setShopping(current => !current)}>{shopping ? "Back to your purchases" : "Buy more supplies →"}</button>}{shopping && <TenantMerchandise purchaseMode unitKey={unitKey} onSaved={async () => {}} />}</section>;
}
