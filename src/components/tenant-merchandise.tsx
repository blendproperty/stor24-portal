"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { TenantCheckout } from "@/components/tenant-checkout";
type Product = { id: string; name: string; imageUrl: string | null; category: string; price: string; available: number };
const money = (value: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
export function TenantMerchandise({ unitKey, onSaved, purchaseMode = false }: { unitKey: string; onSaved: () => Promise<void>; purchaseMode?: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [testAccess, setTestAccess] = useState(false);
  const [r10Test, setR10Test] = useState(false);
  const [basketLocked, setBasketLocked] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("Loading your store’s packing supplies…");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestKey = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false;
    fetch(`/api/tenant/merchandise?unit=${encodeURIComponent(unitKey)}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Catalogue unavailable.");
      if (!disposed) { setCheckoutEnabled(body.data.checkoutEnabled === true); setR10Test(body.data.r10Test === true); setTestAccess(body.data.testAccess === true); setProducts(body.data.products); setMessage(body.data.products.length ? "" : "Your store has no products available online at the moment."); }
    }).catch(error => { if (!disposed) setMessage(error.message); });
    return () => { disposed = true; };
  }, [unitKey]);
  const cents = products.reduce((total, product) => total + Math.round(Number(product.price) * 100) * (quantities[product.id] ?? 0), 0);
  const count = Object.values(quantities).reduce((total, quantity) => total + quantity, 0);
  if (purchaseMode) return <div className="tenant-purchase-catalogue">
    <h3>Add products</h3>
    <label>Find packing supplies<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Boxes, tape, bubble wrap…" /></label>
    <div className="tenant-product-grid">{products.filter(product => `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase())).map(product => <article key={product.id}>
      {product.imageUrl && <Image src={product.imageUrl} width={240} height={180} unoptimized alt={product.name}/>}
      <h3>{product.name}</h3><p>{money(Number(product.price))} · {product.available ? `${product.available} available` : "Out of stock"}</p>
      <label>Quantity<input aria-label={`Quantity for ${product.name}`} type="number" min={0} max={Math.min(100, product.available)} disabled={basketLocked || !product.available} value={quantities[product.id] ?? 0} onChange={event => setQuantities(current => ({ ...current, [product.id]: Math.min(100, product.available, Math.max(0, Math.trunc(Number(event.target.value) || 0))) }))}/></label>
    </article>)}</div>
    <div className="tenant-shop-total"><strong>Your basket · {count} items · {money(cents / 100)}</strong></div>
    {r10Test ? <p role="status"><strong>R10 test checkout.</strong> The basket value above is retained, but only R10 is sent to Netcash for this test. This will not pay for the merchandise, change your account balance or authorise collection. Use the approved test card only.</p> : testAccess && <p role="status">Controlled checkout access is enabled for your account. This is not a simulated payment: checkout uses the full basket total shown above. Only complete payment using your approved testing arrangement.</p>}
    <TenantCheckout unitKey={unitKey} disabled={!checkoutEnabled} onLocked={setBasketLocked} items={products.filter(product => quantities[product.id] > 0).map(product => ({ productId: product.id, quantity: quantities[product.id] }))}/>
    {basketLocked && <p>Your basket is locked while checkout is in progress. Check or cancel the unpaid order before changing quantities.</p>}
    <p>{r10Test ? "Test results are kept separate from purchases. No merchandise will be supplied for the R10 test." : checkoutEnabled ? "Payment confirms your purchase. Stock and prices are checked again at checkout." : "Online checkout is not enabled. This basket has not been ordered or charged."}</p>
    {message && <p role="status">{message}</p>}
  </div>;
  async function submit() {
    if (purchaseMode || busy || submitted || !count) return;
    setBusy(true); setFailed(false); setMessage("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/tenant/merchandise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit: unitKey, idempotencyKey: requestKey.current, items: products.filter(product => quantities[product.id] > 0).map(product => ({ productId: product.id, quantity: quantities[product.id] })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "We couldn’t submit your request. Please try again.");
      setSubmitted(true); setMessage(`${body.message} Reference: ${body.data.id}. Quoted total: ${money(Number(body.data.total))}.`);
      try { await onSaved(); } catch { setMessage(current => `${current} Refresh to update the request history.`); }
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <details className="tenant-card tenant-shop" id="tenant-shop"><summary>Shop packing supplies · boxes, tape and more</summary><span className="tenant-eyebrow">A LITTLE EXTRA ROOM TO PACK</span><h2>Need more packing supplies?</h2><p>Pick what you need. Your store will confirm availability, payment and collection. Sending a request does not charge your account or reserve stock.</p><label>Find packing supplies<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Boxes, tape, bubble wrap…" /></label><div className="tenant-product-grid">{products.filter(product => `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase())).map(product => <article key={product.id}>{product.imageUrl ? <Image src={product.imageUrl} width={240} height={180} unoptimized alt={product.name}/> : <div className="tenant-product-placeholder">STOR24 · PACKING SUPPLIES</div>}<h3>{product.name}</h3><p>{money(Number(product.price))} · {product.available ? `${product.available} available` : "Out of stock"}</p><label>Quantity<input aria-label={`Quantity for ${product.name}`} type="number" min={0} max={Math.min(100, product.available)} disabled={busy || submitted || !product.available} value={quantities[product.id] ?? 0} onChange={event => { requestKey.current = null; setQuantities(current => ({ ...current, [product.id]: Math.min(100, product.available, Math.max(0, Math.trunc(Number(event.target.value) || 0))) })); }}/></label></article>)}</div><div className="tenant-shop-total"><strong>{count} items · {money(cents / 100)}</strong><button className="tenant-primary" disabled={busy || submitted || !count} onClick={() => void submit()}>{busy ? "Sending…" : submitted ? "Request received ✓" : "Request these supplies →"}</button></div><p className={failed ? "tenant-error" : undefined} role={failed ? "alert" : "status"}>{message}</p>{submitted && <button onClick={() => { setSubmitted(false); setQuantities({}); requestKey.current = null; setMessage(""); }}>Start another request</button>}</details>;
}
