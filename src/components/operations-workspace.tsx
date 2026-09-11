"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, PackageCheck, Plus, RefreshCw, Search, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MerchandiseOrderQueue } from "@/components/merchandise-order-queue";
import { StatusPill } from "@/components/status-pill";
import Link from "next/link";
import { formatSouthAfricaDate, formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { PackageEditorModal, ProductEditorModal, type MerchandisePackage, type MerchandiseProduct } from "@/components/merchandise-editor";

type Task = { id: string; title: string; description?: string | null; customerId?: string | null; status: string; priority: string; dueAt: string | null; facility?: { name: string } | null; assignee?: { name: string } | null };
type Maintenance = { id: string; title: string; status: string; priority: string; unit?: { number: string } | null; facility: { name: string } };
type Product = MerchandiseProduct;
type StoragePackage = MerchandisePackage;
type Close = { id: string; businessDate: string; status: string; variance: string | null; facility: { name: string } };
type Facility = { id: string; name: string; units: { id: string; number: string; status: string }[] };
type OperationsData = { tasks: Task[]; maintenance: Maintenance[]; products: Product[]; storagePackages: StoragePackage[]; dailyCloses: Close[]; notes: unknown[]; facilities: Facility[] };

export function OperationsWorkspace({ view = "operations" }: { view?: "operations" | "merchandise" }) {
  const [data, setData] = useState<OperationsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintenanceFacilityId, setMaintenanceFacilityId] = useState("");
  const [showProduct, setShowProduct] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showPackage, setShowPackage] = useState(false);
  const [packageFacilityId, setPackageFacilityId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<StoragePackage | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productCategory, setProductCategory] = useState("ALL");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/operations", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "Operations data could not be loaded."); return; }
    setData(payload.data); setError("");
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/operations", { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
      if (cancelled) return;
      if (!response.ok) setError(payload.error?.message ?? "Operations data could not be loaded.");
      else setData(payload.data);
    });
    return () => { cancelled = true; };
  }, []);

  async function createTask(formData: FormData) {
    setBusy(true);
    const response = await fetch("/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", payload: { facilityId: formData.get("facilityId") || undefined, title: formData.get("title"), description: formData.get("description") || undefined, priority: formData.get("priority"), dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined } }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Task could not be created."); return; }
    setShowTask(false); await load();
  }

  async function completeTask(id: string) {
    await fetch(`/api/v1/operations/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "COMPLETED" }) });
    await load();
  }

  async function createMaintenance(formData: FormData) {
    setBusy(true);
    const response = await fetch("/api/v1/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "maintenance",
        payload: {
          facilityId: formData.get("facilityId"),
          unitId: formData.get("unitId") || undefined,
          title: formData.get("title"),
          description: formData.get("description") || undefined,
          priority: formData.get("priority"),
          dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined,
        },
      }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Maintenance request could not be created."); return; }
    setShowMaintenance(false);
    setMaintenanceFacilityId("");
    await load();
  }

  async function updateMaintenance(id: string, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    setBusy(true);
    const response = await fetch(`/api/v1/operations/maintenance/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Maintenance request could not be updated."); return; }
    await load();
  }

  async function createInventory(kind: "product" | "stockMovement" | "storagePackage", payload: Record<string, unknown>) {
    setBusy(true); setError("");
    const response = await fetch("/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, payload }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "Inventory could not be updated."); return false; }
    await load(); return true;
  }

  async function createProduct(formData: FormData) {
    if (await createInventory("product", { facilityId: formData.get("facilityId"), sku: formData.get("sku"), name: formData.get("name"), category: formData.get("category"), barcode: formData.get("barcode") || undefined, imageUrl: formData.get("imageUrl") || undefined, costPrice: Number(formData.get("costPrice")), sellingPrice: Number(formData.get("sellingPrice")), quantityOnHand: Number(formData.get("quantityOnHand")), reorderPoint: Number(formData.get("reorderPoint")) })) setShowProduct(false);
  }

  async function updateProduct(formData: FormData) {
    if (!selectedProduct) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/operations/products/${selectedProduct.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: formData.get("sku"), name: formData.get("name"), category: formData.get("category"), barcode: formData.get("barcode") || undefined, imageUrl: formData.get("imageUrl") || null, costPrice: Number(formData.get("costPrice")), sellingPrice: Number(formData.get("sellingPrice")), reorderPoint: Number(formData.get("reorderPoint")), active: formData.get("active") === "on" }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "Product could not be updated."); return; }
    setSelectedProduct(null); await load();
  }

  async function moveStock(formData: FormData) {
    if (await createInventory("stockMovement", { productId: formData.get("productId"), type: formData.get("type"), quantity: Number(formData.get("quantity")), unitCost: formData.get("unitCost") ? Number(formData.get("unitCost")) : undefined, reason: formData.get("reason") || undefined, reference: formData.get("reference") || undefined })) setShowStock(false);
  }

  async function createPackage(formData: FormData) {
    const selectedProducts = data?.products.filter((product) => product.facilityId === packageFacilityId && Number(formData.get(`quantity:${product.id}`)) > 0) ?? [];
    if (await createInventory("storagePackage", { facilityId: packageFacilityId, code: formData.get("code"), name: formData.get("name"), description: formData.get("description"), badge: formData.get("badge") || undefined, imageUrl: formData.get("imageUrl") || undefined, sellingPrice: Number(formData.get("sellingPrice")), minUnitAreaSqM: formData.get("minUnitAreaSqM") ? Number(formData.get("minUnitAreaSqM")) : undefined, maxUnitAreaSqM: formData.get("maxUnitAreaSqM") ? Number(formData.get("maxUnitAreaSqM")) : undefined, active: true, items: selectedProducts.map((product) => ({ productId: product.id, quantity: Number(formData.get(`quantity:${product.id}`)) })) })) { setShowPackage(false); setPackageFacilityId(""); }
  }

  async function updatePackage(formData: FormData) {
    if (!selectedPackage || !data) return;
    const selectedProducts = data.products.filter((product) => product.facilityId === selectedPackage.facilityId && Number(formData.get(`quantity:${product.id}`)) > 0);
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/operations/storage-packages/${selectedPackage.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: formData.get("code"), name: formData.get("name"), description: formData.get("description"), badge: formData.get("badge") || undefined, imageUrl: formData.get("imageUrl") || null,
        sellingPrice: Number(formData.get("sellingPrice")), minUnitAreaSqM: formData.get("minUnitAreaSqM") ? Number(formData.get("minUnitAreaSqM")) : undefined,
        maxUnitAreaSqM: formData.get("maxUnitAreaSqM") ? Number(formData.get("maxUnitAreaSqM")) : undefined, sortOrder: Number(formData.get("sortOrder")),
        active: formData.get("active") === "on", items: selectedProducts.map((product) => ({ productId: product.id, quantity: Number(formData.get(`quantity:${product.id}`)) })),
      }),
    });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "Package could not be updated."); return; }
    setSelectedPackage(null); await load();
  }

  const openTasks = data?.tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)) ?? [];
  const service = data?.maintenance.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)) ?? [];
  const reorder = data?.products.filter((product) => product.quantityOnHand <= product.reorderPoint) ?? [];
  const productCategories = Array.from(new Set(data?.products.map((product) => product.category) ?? [])).sort();
  const visibleProducts = data?.products.filter((product) => (productCategory === "ALL" || product.category === productCategory) && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(productQuery.toLowerCase())) ?? [];
  const packageFacility = data?.facilities.find((facility) => facility.id === packageFacilityId);
  const draftPackage: StoragePackage | null = packageFacility ? { id: "", facilityId: packageFacility.id, code: "", name: "", description: "", badge: null, imageUrl: null, sellingPrice: "0", minUnitAreaSqM: null, maxUnitAreaSqM: null, sortOrder: data?.storagePackages.length ?? 0, active: true, facility: { name: packageFacility.name }, items: [] } : null;

  const merchandiseModals = <>
    {showProduct ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Merchandise catalogue</p><h2>Add a product</h2><form action={createProduct} className="invite-form"><label>Facility<select name="facilityId" required><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>SKU<input name="sku" required maxLength={60}/></label><label>Product name<input name="name" required maxLength={160}/></label><label>Category<input name="category" required placeholder="Boxes, protection, locks…"/></label><label>Barcode<input name="barcode"/></label><div className="form-grid two"><label>Cost price<input name="costPrice" type="number" min="0" step="0.01" defaultValue="0" required/></label><label>Selling price<input name="sellingPrice" type="number" min="0" step="0.01" required/></label><label>Opening stock<input name="quantityOnHand" type="number" min="0" step="1" defaultValue="0" required/></label><label>Reorder point<input name="reorderPoint" type="number" min="0" step="1" defaultValue="0" required/></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowProduct(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Add product"}</button></div></form></div></div> : null}
    {selectedProduct ? <ProductEditorModal product={selectedProduct} busy={busy} close={() => setSelectedProduct(null)} save={updateProduct}/> : null}
    {showStock ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Stock control</p><h2>Record stock movement</h2><form action={moveStock} className="invite-form"><label>Product<select name="productId" required><option value="">Choose product</option>{data?.products.map((product) => <option key={product.id} value={product.id}>{product.facility.name} · {product.name} · {product.quantityOnHand - product.quantityReserved} available</option>)}</select></label><label>Movement<select name="type" defaultValue="RECEIPT"><option>RECEIPT</option><option>ADJUSTMENT</option><option>DAMAGE</option><option>RETURN</option></select></label><label>Quantity<input name="quantity" type="number" step="1" required/></label><label>Unit cost<input name="unitCost" type="number" min="0" step="0.01"/></label><label>Supplier/reference<input name="reference"/></label><label>Reason<input name="reason"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowStock(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Record movement"}</button></div></form></div></div> : null}
    {showPackage && !draftPackage ? <div className="modal-backdrop"><div className="modal-card package-facility-dialog" role="dialog" aria-modal="true"><p className="eyebrow">Package studio</p><h2>Where will this package be sold?</h2><p className="modal-copy">Choose a facility so we can show the correct products, prices and available stock.</p><label>Facility<select value={packageFacilityId} onChange={(event) => setPackageFacilityId(event.target.value)}><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowPackage(false); setPackageFacilityId(""); }}>Cancel</button></div></div></div> : null}
    {showPackage && draftPackage && data ? <PackageEditorModal mode="create" storagePackage={draftPackage} products={data.products} busy={busy} close={() => { setShowPackage(false); setPackageFacilityId(""); }} save={createPackage}/> : null}
    {selectedPackage && data ? <PackageEditorModal storagePackage={selectedPackage} products={data.products} busy={busy} close={() => setSelectedPackage(null)} save={updatePackage}/> : null}
  </>;

  if (view === "merchandise") return <div className="page-stack">
    <details className="panel"><summary>Customer purchases · collection and delivery</summary><MerchandiseOrderQueue /></details>
    <PageHeader eyebrow="Operations · Merchandise" title="Merchandise" description="A dedicated catalogue, stock and package workspace for everything sold alongside a Stor24 unit." action={<span className="inline-actions"><button className="button button-secondary" onClick={() => setShowStock(true)}>Move stock</button><button className="button button-primary" onClick={() => setShowProduct(true)}><Plus size={16}/> Add product</button></span>} />
    {error ? <p className="form-error">{error}</p> : null}
    <section className="summary-strip">
      {[["Products", data?.products.length ?? 0], ["Active packages", data?.storagePackages.filter((pack) => pack.active).length ?? 0], ["Reorder items", reorder.length], ["Facilities", data?.facilities.length ?? 0]].map(([label, value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    <section className="panel merchandise-catalogue-panel"><div className="hub-heading"><div><p className="eyebrow">Catalogue</p><h2>Products and stock</h2><p>Search, filter and open any product to manage its image, pricing and stock controls.</p></div></div><div className="catalogue-toolbar"><label><Search size={16}/><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products or SKU…"/></label><div className="category-pills"><button className={productCategory === "ALL" ? "active" : ""} onClick={() => setProductCategory("ALL")}>All <span>{data?.products.length ?? 0}</span></button>{productCategories.map((category) => <button key={category} className={productCategory === category ? "active" : ""} onClick={() => setProductCategory(category)}>{category}</button>)}</div></div><div className="table-wrap"><table className="data-table merchandise-table"><thead><tr><th>Image</th><th>Product</th><th>Price</th><th>Stock</th><th>Facility</th><th>Status</th></tr></thead><tbody>{visibleProducts.length ? visibleProducts.map((product) => { const available = product.quantityOnHand - product.quantityReserved; return <tr key={product.id} className="clickable-data-row" tabIndex={0} onClick={() => setSelectedProduct(product)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedProduct(product); }}><td><span className="catalogue-table-thumb" style={product.imageUrl ? { backgroundImage: `url(${product.imageUrl})` } : undefined}><PackageCheck size={18}/></span></td><td className="primary-cell">{product.name}<span className="secondary-cell">{product.sku} · {product.category}</span></td><td className="catalogue-price">R {Number(product.sellingPrice).toFixed(2)}</td><td><strong>{available}</strong><span className="secondary-cell">{product.quantityReserved} reserved</span></td><td>{product.facility.name}</td><td><StatusPill tone={!product.active ? "neutral" : available <= product.reorderPoint ? "warning" : "positive"}>{!product.active ? "Inactive" : available <= product.reorderPoint ? "Reorder" : "In stock"}</StatusPill></td></tr>; }) : <tr><td colSpan={6} className="empty-cell">No products match these filters.</td></tr>}</tbody></table></div></section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Package studio</p><h2>Customer-ready packages</h2><p className="panel-subtitle">Build, price and edit packages from the product catalogue.</p></div><button className="button button-primary" onClick={() => setShowPackage(true)}><PackageCheck size={16}/> New package</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Package</th><th>Facility</th><th>Contents</th><th>Price</th><th>Availability</th></tr></thead><tbody>{data?.storagePackages.length ? data.storagePackages.map((pack) => <tr key={pack.id} className="clickable-data-row" tabIndex={0} onClick={() => setSelectedPackage(pack)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPackage(pack); }}><td className="primary-cell">{pack.imageUrl ? <div className="package-list-art" style={{ backgroundImage: `url(${pack.imageUrl})` }}><strong>{pack.name}</strong></div> : pack.name}<span className="secondary-cell">{pack.code}{pack.badge ? ` · ${pack.badge}` : ""}</span></td><td>{pack.facility.name}</td><td>{pack.items.map((item) => `${item.quantity} × ${item.product.name}`).join(", ")}</td><td>R {Number(pack.sellingPrice).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</td><td><StatusPill tone={pack.active ? "positive" : "neutral"}>{pack.active ? "Available to channels" : "Inactive"}</StatusPill></td></tr>) : <tr><td colSpan={5} className="empty-cell">No packages configured.</td></tr>}</tbody></table></div></section>
    {merchandiseModals}
  </div>;

  return <div className="page-stack">
    <PageHeader eyebrow="Facility workflows" title="Operations centre" description="Database-backed work queues, maintenance and end-of-day control for Stor24." action={<button className="button button-primary" onClick={() => setShowTask(true)}><Plus size={16}/> New task</button>} />
    {error ? <p className="form-error">{error}</p> : null}
    <section className="summary-strip">
      {[["Open tasks", openTasks.length], ["Service required", service.length], ["Reorder items", reorder.length], ["Daily closes", data?.dailyCloses.length ?? 0]].map(([label, value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Accounts</p><h2>Customer account workflows</h2><p className="panel-subtitle">Start the primary rental and billing workflows from one place.</p></div></div><div className="operations-account-grid">
      <Link href="/operations/move-in"><strong>Move in</strong><span>Select a vacant unit and create the tenancy account.</span></Link>
      <Link href="/operations/accounts"><strong>Payments</strong><span>Post and review customer payments.</span></Link>
      <Link href="/operations/accounts"><strong>Transfer</strong><span>Move an active tenant to another available unit.</span></Link>
      <Link href="/operations/accounts"><strong>Move out</strong><span>Close an occupancy and release the unit.</span></Link>
      <Link href="/operations/merchandise"><strong>Merchandise</strong><span>Open the dedicated products, stock and package workspace.</span></Link>
    </div></section>
    <section className="dashboard-grid">
      <article className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Work queues</p><h2>Assigned operational tasks</h2></div><ClipboardList size={21}/></div>
        <div className="work-list">{openTasks.length ? openTasks.map((task) => <div className="work-row" key={task.id}><span className={`work-icon ${task.priority === "URGENT" ? "work-icon-danger" : task.priority === "HIGH" ? "work-icon-warning" : ""}`}><ClipboardList size={18}/></span><div className="work-copy"><strong>{task.title}</strong><small>{task.facility?.name ?? "Portfolio"} · {task.assignee?.name ?? "Unassigned"} · {task.dueAt ? `${formatSouthAfricaDateTime(task.dueAt)} SAST` : "No due date"}</small>{task.description && <details><summary>View request details</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.description}</p>{task.customerId && <Link href={`/tenants?customer=${encodeURIComponent(task.customerId)}`}>Open customer record →</Link>}</details>}</div><button className="text-button" onClick={() => completeTask(task.id)}>Complete</button></div>) : <div className="empty-state"><CheckCircle2 size={32}/><strong>No open tasks</strong><p>Create a task to start the facility work queue.</p></div>}</div>
      </article>
      <article className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Service required</p><h2>Maintenance queue</h2></div><button className="button button-secondary" onClick={() => setShowMaintenance(true)}><Plus size={16}/> New request</button></div>
        <div className="work-list">{service.length ? service.map((item) => <div className="work-row" key={item.id}><span className="work-icon work-icon-warning"><Wrench size={18}/></span><span className="work-copy"><strong>{item.title}</strong><small>{item.facility.name}{item.unit ? ` · Unit ${item.unit.number}` : ""}</small></span><StatusPill tone={item.priority === "URGENT" ? "danger" : "warning"}>{item.status}</StatusPill><span className="inline-actions">{item.status !== "IN_PROGRESS" ? <button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "IN_PROGRESS")}>Start</button> : null}<button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "COMPLETED")}>Complete</button><button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "CANCELLED")}>Cancel</button></span></div>) : <div className="empty-state"><Wrench size={32}/><strong>No service requests</strong><p>Unit and facility maintenance will appear here.</p></div>}</div>
      </article>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="hub-heading"><div><h2>End-of-day control</h2><p>Closed periods and recorded cash variance.</p></div><RefreshCw size={20}/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Facility</th><th>Status</th><th>Variance</th></tr></thead><tbody>{data?.dailyCloses.length ? data.dailyCloses.map((close) => <tr key={close.id}><td>{formatSouthAfricaDate(close.businessDate)}</td><td>{close.facility.name}</td><td><StatusPill tone="positive">{close.status}</StatusPill></td><td>{close.variance ?? "—"}</td></tr>) : <tr><td colSpan={4} className="empty-cell">No daily closes recorded.</td></tr>}</tbody></table></div></article>
    </section>
    {showTask ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Work queue</p><h2>Create operational task</h2><form action={createTask} className="invite-form"><label>Facility<select name="facilityId" required><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowTask(false)}>Cancel</button><button className="button button-primary" disabled={busy || !data?.facilities.length}>{busy ? "Saving…" : "Create task"}</button></div></form></div></div> : null}
    {showMaintenance ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Unit availability</p><h2>Create maintenance request</h2><p className="panel-subtitle">Selecting a unit immediately removes it from bookable availability until all linked maintenance is complete.</p><form action={createMaintenance} className="invite-form"><label>Facility<select name="facilityId" required value={maintenanceFacilityId} onChange={(event) => setMaintenanceFacilityId(event.target.value)}><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Unit (optional)<select name="unitId" defaultValue=""><option value="">Facility-level request</option>{data?.facilities.find((facility) => facility.id === maintenanceFacilityId)?.units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.number}{unit.status === "SERVICE" ? " · already in service" : ""}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowMaintenance(false); setMaintenanceFacilityId(""); }}>Cancel</button><button className="button button-primary" disabled={busy || !maintenanceFacilityId}>{busy ? "Saving…" : "Create request"}</button></div></form></div></div> : null}
  </div>;
}
