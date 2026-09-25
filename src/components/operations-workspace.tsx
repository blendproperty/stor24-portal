"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [readAccess, setReadAccess] = useState<"denied" | "signed-out" | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const taskRequest = useRef(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNeedsCheck, setTaskNeedsCheck] = useState(false);
  const [taskMessage, setTaskMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const taskCreationRequest = useRef(false);
  const [taskCreationMessage, setTaskCreationMessage] = useState("");
  const [taskCreationUncertain, setTaskCreationUncertain] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const maintenanceRequest = useRef(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceUncertain, setMaintenanceUncertain] = useState(false);
  const [maintenanceFacilityId, setMaintenanceFacilityId] = useState("");
  const [showProduct, setShowProduct] = useState(false);
  const productCreationRequest = useRef(false);
  const [productCreationMessage, setProductCreationMessage] = useState("");
  const [productCreationUncertain, setProductCreationUncertain] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const stockRequest = useRef(false);
  const [stockMessage, setStockMessage] = useState("");
  const [stockUncertain, setStockUncertain] = useState(false);
  const [showPackage, setShowPackage] = useState(false);
  const [packageFacilityId, setPackageFacilityId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<StoragePackage | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productCategory, setProductCategory] = useState("ALL");

  const handleReadAccessFailure = useCallback((status: number) => {
    if (status !== 401 && status !== 403) return false;
    setData(null);
    setReadFailed(false);
    setReadAccess(status === 403 ? "denied" : "signed-out");
    setError(status === 403 ? "You do not have access to this workspace. If you require access, please contact your administrator." : "Please sign in again to view this workspace.");
    setShowTask(false);
    setShowMaintenance(false);
    setShowProduct(false);
    setShowStock(false);
    setShowPackage(false);
    setSelectedProduct(null);
    setSelectedPackage(null);
    setMaintenanceFacilityId("");
    setPackageFacilityId("");
    return true;
  }, []);

  const load = useCallback(async () => {
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    setLoading(true);
    setReadAccess(null);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/v1/operations", { cache: "no-store", signal: controller.signal });
      if (readRequest.current !== controller) return;
      if (handleReadAccessFailure(response.status)) return;
      const payload = await response.json();
      if (!response.ok || !payload.data || !["tasks", "maintenance", "products", "storagePackages", "dailyCloses", "notes", "facilities"].every(key => Array.isArray(payload.data[key]))) throw new Error("Operations data unavailable");
      if (readRequest.current !== controller) return;
      setData(payload.data);
      setError("");
      setReadFailed(false);
    } catch {
      if (readRequest.current !== controller) return;
      setReadFailed(true);
      setError("Operations data could not be loaded. Please try again.");
    } finally {
      clearTimeout(timeout);
      if (readRequest.current === controller) {
        readRequest.current = null;
        setLoading(false);
      }
    }
  }, [handleReadAccessFailure]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; readRequest.current?.abort(); readRequest.current = null; };
  }, [load]);

  async function createTask(formData: FormData) {
    if (taskCreationRequest.current || taskCreationUncertain) return;
    taskCreationRequest.current = true;
    setBusy(true);
    setTaskCreationMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const title = String(formData.get("title") ?? "").trim();
      const response = await fetch("/api/v1/operations", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", payload: { facilityId: formData.get("facilityId") || undefined, title, description: formData.get("description") || undefined, priority: formData.get("priority"), dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined } }) });
      const payload = await response.json();
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
        setTaskCreationMessage(typeof payload.error?.message === "string" ? payload.error.message : "Task was not saved. Check the details and your access, then try again.");
        return;
      }
      if (!response.ok || typeof payload.data?.id !== "string" || !payload.data.id || payload.data.title !== title) throw new Error("Unconfirmed task creation");
      setShowTask(false);
      await load();
    } catch {
      setTaskCreationUncertain(true);
      setTaskCreationMessage("We could not confirm whether this task was saved. Reload and check the task list before creating it again.");
    } finally {
      clearTimeout(timeout);
      taskCreationRequest.current = false;
      setBusy(false);
    }
  }

  async function completeTask(id: string) {
    if (taskRequest.current || taskNeedsCheck) return;
    taskRequest.current = true;
    setTaskBusy(true);
    setTaskMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/v1/operations/tasks/${id}`, { method: "PATCH", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "COMPLETED" }) });
      const payload = await response.json();
      if (!response.ok || payload.data?.id !== id || payload.data?.status !== "COMPLETED") throw new Error("Unconfirmed task completion");
      setData(current => current ? { ...current, tasks: current.tasks.map(task => task.id === id ? { ...task, status: "COMPLETED" } : task) } : current);
      setTaskMessage("Task completed.");
    } catch {
      setTaskNeedsCheck(true);
      setTaskMessage("We could not confirm this task was completed. Check its current status before trying again.");
    } finally {
      clearTimeout(timeout);
      taskRequest.current = false;
      setTaskBusy(false);
    }
  }

  async function checkTaskStatus() {
    if (taskRequest.current) return;
    taskRequest.current = true;
    setTaskBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/v1/operations", { cache: "no-store", signal: controller.signal });
      if (handleReadAccessFailure(response.status)) return;
      const payload = await response.json();
      const tasks = payload.data?.tasks;
      if (!response.ok || !Array.isArray(tasks) || tasks.some(task => typeof task.id !== "string" || typeof task.title !== "string" || !["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"].includes(task.status))) throw new Error("Task status unavailable");
      setData(current => current ? { ...current, tasks } : current);
      setTaskNeedsCheck(false);
      setTaskMessage("Task status refreshed. Completed tasks are no longer in the open queue.");
    } catch {
      setTaskMessage("Task status could not be checked. Please check again before completing another task.");
    } finally {
      clearTimeout(timeout);
      taskRequest.current = false;
      setTaskBusy(false);
    }
  }

  async function createMaintenance(formData: FormData) {
    if (maintenanceRequest.current || maintenanceUncertain) return;
    maintenanceRequest.current = true;
    setBusy(true);
    setMaintenanceMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const title = String(formData.get("title") ?? "").trim();
      const facilityId = String(formData.get("facilityId") ?? "");
      const unitId = formData.get("unitId") || null;
      const response = await fetch("/api/v1/operations", {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "maintenance", payload: {
          facilityId, unitId: unitId || undefined, title,
          description: formData.get("description") || undefined,
          priority: formData.get("priority"),
          dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined,
        } }),
      });
      const payload = await response.json();
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
        setMaintenanceMessage(typeof payload.error?.message === "string" ? payload.error.message : "Request was not saved. Check the details and your access, then try again.");
        return;
      }
      if (!response.ok || typeof payload.data?.id !== "string" || !payload.data.id || payload.data.title !== title || payload.data.facilityId !== facilityId || payload.data.unitId !== unitId) throw new Error("Unconfirmed maintenance creation");
      setShowMaintenance(false);
      setMaintenanceFacilityId("");
      await load();
    } catch {
      setMaintenanceUncertain(true);
      setMaintenanceMessage("We could not confirm whether this maintenance request was saved. Reload and check the request list and unit availability before creating it again.");
    } finally {
      clearTimeout(timeout);
      maintenanceRequest.current = false;
      setBusy(false);
    }
  }

  async function updateMaintenance(id: string, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    if (maintenanceRequest.current || maintenanceUncertain) return;
    maintenanceRequest.current = true;
    setBusy(true);
    setMaintenanceMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/v1/operations/maintenance/${id}`, {
        method: "PATCH", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
        setMaintenanceMessage(typeof payload.error?.message === "string" ? payload.error.message : "Maintenance was not updated. Check your access and try again.");
        return;
      }
      if (!response.ok || payload.data?.id !== id || payload.data.status !== status) throw new Error("Unconfirmed maintenance change");
      setData(current => current ? { ...current, maintenance: current.maintenance.map(item => item.id === id ? { ...item, status } : item) } : current);
      await load();
    } catch {
      setMaintenanceUncertain(true);
      setMaintenanceMessage("We could not confirm the maintenance change. Reload and check the request status and unit availability before making another change.");
    } finally {
      clearTimeout(timeout);
      maintenanceRequest.current = false;
      setBusy(false);
    }
  }

  async function createInventory(kind: "storagePackage", payload: Record<string, unknown>) {
    setBusy(true); setError("");
    const response = await fetch("/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, payload }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "Inventory could not be updated."); return false; }
    await load(); return true;
  }

  async function createProduct(formData: FormData) {
    if (productCreationRequest.current || productCreationUncertain) return;
    productCreationRequest.current = true;
    setBusy(true);
    setProductCreationMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const facilityId = String(formData.get("facilityId") ?? "");
      const sku = String(formData.get("sku") ?? "").trim();
      const name = String(formData.get("name") ?? "").trim();
      const quantityOnHand = Number(formData.get("quantityOnHand"));
      const response = await fetch("/api/v1/operations", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "product", payload: { facilityId, sku, name, quantityOnHand, category: formData.get("category"), barcode: formData.get("barcode") || undefined, imageUrl: formData.get("imageUrl") || undefined, costPrice: Number(formData.get("costPrice")), sellingPrice: Number(formData.get("sellingPrice")), reorderPoint: Number(formData.get("reorderPoint")) } }) });
      const body = await response.json();
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
        setProductCreationMessage(typeof body.error?.message === "string" ? body.error.message : "Product was not created. Check the details and your access, then try again.");
        return;
      }
      if (!response.ok || typeof body.data?.id !== "string" || !body.data.id || body.data.facilityId !== facilityId || body.data.sku !== sku || body.data.name !== name || body.data.quantityOnHand !== quantityOnHand) throw new Error("Unconfirmed product creation");
      setShowProduct(false);
      setProductCreationMessage("Product created.");
      await load();
    } catch {
      setProductCreationUncertain(true);
      setProductCreationMessage("We could not confirm whether this product was created. Reload the catalogue and check the product and opening stock before creating it again.");
    } finally {
      clearTimeout(timeout);
      productCreationRequest.current = false;
      setBusy(false);
    }
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
    if (stockRequest.current || stockUncertain) return;
    stockRequest.current = true;
    setBusy(true);
    setStockMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const productId = String(formData.get("productId") ?? "");
      const type = String(formData.get("type") ?? "");
      const quantity = Number(formData.get("quantity"));
      const delta = ["SALE", "DAMAGE"].includes(type) ? -Math.abs(quantity) : quantity;
      const response = await fetch("/api/v1/operations", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "stockMovement", payload: { productId, type, quantity, unitCost: formData.get("unitCost") ? Number(formData.get("unitCost")) : undefined, reason: formData.get("reason") || undefined, reference: formData.get("reference") || undefined } }) });
      const body = await response.json();
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
        setStockMessage(typeof body.error?.message === "string" ? body.error.message : "Stock movement was not recorded. Check the details and available quantity, then try again.");
        return;
      }
      if (!response.ok || typeof body.data?.id !== "string" || !body.data.id || body.data.productId !== productId || body.data.type !== type || body.data.quantity !== delta) throw new Error("Unconfirmed stock movement");
      setShowStock(false);
      setStockMessage("Stock movement recorded.");
      await load();
    } catch {
      setStockUncertain(true);
      setStockMessage("We could not confirm whether this stock movement was recorded. Reload inventory and check the quantity and audit history before recording it again.");
    } finally {
      clearTimeout(timeout);
      stockRequest.current = false;
      setBusy(false);
    }
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

  if (!data) return <div className="page-stack">
    <PageHeader eyebrow="Facility workflows" title={view === "merchandise" ? "Merchandise" : "Operations centre"} description="Work queues and facility records." />
    <section className="panel panel-spacious">
      {loading ? <p role="status">Loading operations data…</p> : <><p role="alert">{error}</p>{readAccess === "signed-out" ? <Link className="button button-primary" href="/login">Sign in</Link> : <button className="button button-primary" onClick={() => void load()}>{readAccess === "denied" ? "Check access again" : "Retry loading"}</button>}</>}
    </section>
  </div>;

  const readRecovery = readFailed ? <div role="alert"><p>Displayed records may be out of date.</p><button className="button button-primary" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Retry loading"}</button></div> : null;
  const openTasks = data?.tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)) ?? [];
  const service = data?.maintenance.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)) ?? [];
  const reorder = data?.products.filter((product) => product.quantityOnHand <= product.reorderPoint) ?? [];
  const productCategories = Array.from(new Set(data?.products.map((product) => product.category) ?? [])).sort();
  const visibleProducts = data?.products.filter((product) => (productCategory === "ALL" || product.category === productCategory) && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(productQuery.toLowerCase())) ?? [];
  const packageFacility = data?.facilities.find((facility) => facility.id === packageFacilityId);
  const draftPackage: StoragePackage | null = packageFacility ? { id: "", facilityId: packageFacility.id, code: "", name: "", description: "", badge: null, imageUrl: null, sellingPrice: "0", minUnitAreaSqM: null, maxUnitAreaSqM: null, sortOrder: data?.storagePackages.length ?? 0, active: true, facility: { name: packageFacility.name }, items: [] } : null;

  const merchandiseModals = <>
    {showProduct ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Merchandise catalogue</p><h2>Add a product</h2><form onSubmit={(event) => { event.preventDefault(); void createProduct(new FormData(event.currentTarget)); }} className="invite-form">{productCreationMessage ? <div role="alert"><p>{productCreationMessage}</p>{productCreationUncertain ? <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload catalogue</button> : null}</div> : null}<label>Facility<select name="facilityId" required><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>SKU<input name="sku" required maxLength={60}/></label><label>Product name<input name="name" required maxLength={160}/></label><label>Category<input name="category" required placeholder="Boxes, protection, locks…"/></label><label>Barcode<input name="barcode"/></label><div className="form-grid two"><label>Cost price<input name="costPrice" type="number" min="0" step="0.01" defaultValue="0" required/></label><label>Selling price<input name="sellingPrice" type="number" min="0" step="0.01" required/></label><label>Opening stock<input name="quantityOnHand" type="number" min="0" step="1" defaultValue="0" required/></label><label>Reorder point<input name="reorderPoint" type="number" min="0" step="1" defaultValue="0" required/></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowProduct(false)}>Cancel</button><button className="button button-primary" disabled={busy || productCreationUncertain}>{busy ? "Saving…" : "Add product"}</button></div></form></div></div> : null}
    {selectedProduct ? <ProductEditorModal product={selectedProduct} busy={busy} close={() => setSelectedProduct(null)} save={updateProduct}/> : null}
    {showStock ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Stock control</p><h2>Record stock movement</h2><form onSubmit={(event) => { event.preventDefault(); void moveStock(new FormData(event.currentTarget)); }} className="invite-form">{stockMessage ? <div role="alert"><p>{stockMessage}</p>{stockUncertain ? <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload inventory</button> : null}</div> : null}<label>Product<select name="productId" required><option value="">Choose product</option>{data?.products.map((product) => <option key={product.id} value={product.id}>{product.facility.name} · {product.name} · {product.quantityOnHand - product.quantityReserved} available</option>)}</select></label><label>Movement<select name="type" defaultValue="RECEIPT"><option>RECEIPT</option><option>ADJUSTMENT</option><option>DAMAGE</option><option>RETURN</option></select></label><label>Quantity<input name="quantity" type="number" step="1" required/></label><label>Unit cost<input name="unitCost" type="number" min="0" step="0.01"/></label><label>Supplier/reference<input name="reference"/></label><label>Reason<input name="reason"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowStock(false)}>Cancel</button><button className="button button-primary" disabled={busy || stockUncertain}>{busy ? "Saving…" : "Record movement"}</button></div></form></div></div> : null}
    {showPackage && !draftPackage ? <div className="modal-backdrop"><div className="modal-card package-facility-dialog" role="dialog" aria-modal="true"><p className="eyebrow">Package studio</p><h2>Where will this package be sold?</h2><p className="modal-copy">Choose a facility so we can show the correct products, prices and available stock.</p><label>Facility<select value={packageFacilityId} onChange={(event) => setPackageFacilityId(event.target.value)}><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowPackage(false); setPackageFacilityId(""); }}>Cancel</button></div></div></div> : null}
    {showPackage && draftPackage && data ? <PackageEditorModal mode="create" storagePackage={draftPackage} products={data.products} busy={busy} close={() => { setShowPackage(false); setPackageFacilityId(""); }} save={createPackage}/> : null}
    {selectedPackage && data ? <PackageEditorModal storagePackage={selectedPackage} products={data.products} busy={busy} close={() => setSelectedPackage(null)} save={updatePackage}/> : null}
  </>;

  if (view === "merchandise") return <div className="page-stack">
    <PageHeader eyebrow="Operations · Merchandise" title="Merchandise" description="A dedicated catalogue, stock and package workspace for everything sold alongside a Stor24 unit." action={<span className="inline-actions"><button className="button button-secondary" disabled={busy || stockUncertain} onClick={() => setShowStock(true)}>Move stock</button><button className="button button-primary" disabled={busy || productCreationUncertain} onClick={() => setShowProduct(true)}><Plus size={16}/> Add product</button></span>} />
    <details className="panel"><summary>Customer purchases · collection and delivery</summary><MerchandiseOrderQueue /></details>
    {productCreationMessage && !showProduct ? <div role={productCreationUncertain ? "alert" : "status"}><p>{productCreationMessage}</p>{productCreationUncertain ? <button className="button button-primary" onClick={() => window.location.reload()}>Reload catalogue</button> : null}</div> : null}
    {stockMessage && !showStock ? <div role={stockUncertain ? "alert" : "status"}><p>{stockMessage}</p>{stockUncertain ? <button className="button button-primary" onClick={() => window.location.reload()}>Reload inventory</button> : null}</div> : null}
    {error ? <p className="form-error">{error}</p> : null}{readRecovery}
    <section className="summary-strip">
      {[["Products", data?.products.length ?? 0], ["Active packages", data?.storagePackages.filter((pack) => pack.active).length ?? 0], ["Reorder items", reorder.length], ["Facilities", data?.facilities.length ?? 0]].map(([label, value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    <section className="panel merchandise-catalogue-panel"><div className="hub-heading"><div><p className="eyebrow">Catalogue</p><h2>Products and stock</h2><p>Search, filter and open any product to manage its image, pricing and stock controls.</p></div></div><div className="catalogue-toolbar"><label><Search size={16}/><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products or SKU…"/></label><div className="category-pills"><button className={productCategory === "ALL" ? "active" : ""} onClick={() => setProductCategory("ALL")}>All <span>{data?.products.length ?? 0}</span></button>{productCategories.map((category) => <button key={category} className={productCategory === category ? "active" : ""} onClick={() => setProductCategory(category)}>{category}</button>)}</div></div><div className="table-wrap"><table className="data-table merchandise-table"><thead><tr><th>Image</th><th>Product</th><th>Price</th><th>Stock</th><th>Facility</th><th>Status</th></tr></thead><tbody>{visibleProducts.length ? visibleProducts.map((product) => { const available = product.quantityOnHand - product.quantityReserved; return <tr key={product.id} className="clickable-data-row" tabIndex={0} onClick={() => setSelectedProduct(product)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedProduct(product); }}><td><span className="catalogue-table-thumb" style={product.imageUrl ? { backgroundImage: `url(${product.imageUrl})` } : undefined}><PackageCheck size={18}/></span></td><td className="primary-cell">{product.name}<span className="secondary-cell">{product.sku} · {product.category}</span></td><td className="catalogue-price">R {Number(product.sellingPrice).toFixed(2)}</td><td><strong>{available}</strong><span className="secondary-cell">{product.quantityReserved} reserved</span></td><td>{product.facility.name}</td><td><StatusPill tone={!product.active ? "neutral" : available <= product.reorderPoint ? "warning" : "positive"}>{!product.active ? "Inactive" : available <= product.reorderPoint ? "Reorder" : "In stock"}</StatusPill></td></tr>; }) : <tr><td colSpan={6} className="empty-cell">No products match these filters.</td></tr>}</tbody></table></div></section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Package studio</p><h2>Customer-ready packages</h2><p className="panel-subtitle">Build, price and edit packages from the product catalogue.</p></div><button className="button button-primary" onClick={() => setShowPackage(true)}><PackageCheck size={16}/> New package</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Package</th><th>Facility</th><th>Contents</th><th>Price</th><th>Availability</th></tr></thead><tbody>{data?.storagePackages.length ? data.storagePackages.map((pack) => <tr key={pack.id} className="clickable-data-row" tabIndex={0} onClick={() => setSelectedPackage(pack)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPackage(pack); }}><td className="primary-cell">{pack.imageUrl ? <div className="package-list-art" style={{ backgroundImage: `url(${pack.imageUrl})` }}><strong>{pack.name}</strong></div> : pack.name}<span className="secondary-cell">{pack.code}{pack.badge ? ` · ${pack.badge}` : ""}</span></td><td>{pack.facility.name}</td><td>{pack.items.map((item) => `${item.quantity} × ${item.product.name}`).join(", ")}</td><td>R {Number(pack.sellingPrice).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</td><td><StatusPill tone={pack.active ? "positive" : "neutral"}>{pack.active ? "Available to channels" : "Inactive"}</StatusPill></td></tr>) : <tr><td colSpan={5} className="empty-cell">No packages configured.</td></tr>}</tbody></table></div></section>
    {merchandiseModals}
  </div>;

  return <div className="page-stack">
    <PageHeader eyebrow="Facility workflows" title="Operations centre" description="Database-backed work queues, maintenance and end-of-day control for Stor24." action={<button className="button button-primary" onClick={() => setShowTask(true)}><Plus size={16}/> New task</button>} />
    {maintenanceMessage && !showMaintenance ? <div role="alert"><p>{maintenanceMessage}</p>{maintenanceUncertain ? <button className="button button-primary" onClick={() => window.location.reload()}>Reload maintenance status</button> : null}</div> : null}
    {taskMessage ? <div role={taskNeedsCheck ? "alert" : "status"}><p>{taskMessage}</p>{taskNeedsCheck ? <button className="button button-primary" disabled={taskBusy} onClick={checkTaskStatus}>{taskBusy ? "Checking…" : "Check task status"}</button> : null}</div> : null}
    {error ? <p className="form-error">{error}</p> : null}{readRecovery}
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
        <div className="work-list">{openTasks.length ? openTasks.map((task) => <div className="work-row" key={task.id}><span className={`work-icon ${task.priority === "URGENT" ? "work-icon-danger" : task.priority === "HIGH" ? "work-icon-warning" : ""}`}><ClipboardList size={18}/></span><div className="work-copy"><strong>{task.title}</strong><small>{task.facility?.name ?? "Portfolio"} · {task.assignee?.name ?? "Unassigned"} · {task.dueAt ? `${formatSouthAfricaDateTime(task.dueAt)} SAST` : "No due date"}</small>{task.description && <details><summary>View request details</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.description}</p>{task.customerId && <Link href={`/tenants?customer=${encodeURIComponent(task.customerId)}`}>Open customer record →</Link>}</details>}</div><button className="text-button" disabled={taskBusy || taskNeedsCheck} onClick={() => completeTask(task.id)}>{taskBusy ? "Please wait…" : "Complete"}</button></div>) : <div className="empty-state"><CheckCircle2 size={32}/><strong>No open tasks</strong><p>Create a task to start the facility work queue.</p></div>}</div>
      </article>
      <article className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Service required</p><h2>Maintenance queue</h2></div><button className="button button-secondary" disabled={busy || maintenanceUncertain} onClick={() => setShowMaintenance(true)}><Plus size={16}/> New request</button></div>
        <div className="work-list">{service.length ? service.map((item) => <div className="work-row" key={item.id}><span className="work-icon work-icon-warning"><Wrench size={18}/></span><span className="work-copy"><strong>{item.title}</strong><small>{item.facility.name}{item.unit ? ` · Unit ${item.unit.number}` : ""}</small></span><StatusPill tone={item.priority === "URGENT" ? "danger" : "warning"}>{item.status}</StatusPill><span className="inline-actions">{item.status !== "IN_PROGRESS" ? <button className="text-button" disabled={busy || maintenanceUncertain} onClick={() => updateMaintenance(item.id, "IN_PROGRESS")}>Start</button> : null}<button className="text-button" disabled={busy || maintenanceUncertain} onClick={() => updateMaintenance(item.id, "COMPLETED")}>Complete</button><button className="text-button" disabled={busy || maintenanceUncertain} onClick={() => updateMaintenance(item.id, "CANCELLED")}>Cancel</button></span></div>) : <div className="empty-state"><Wrench size={32}/><strong>No service requests</strong><p>Unit and facility maintenance will appear here.</p></div>}</div>
      </article>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="hub-heading"><div><h2>End-of-day control</h2><p>Recorded close snapshots and cash variance.</p></div><RefreshCw size={20}/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Facility</th><th>Status</th><th>Variance</th></tr></thead><tbody>{data?.dailyCloses.length ? data.dailyCloses.map((close) => <tr key={close.id}><td>{formatSouthAfricaDate(close.businessDate)}</td><td>{close.facility.name}</td><td><StatusPill tone={close.status === "CLOSED" ? "positive" : "warning"}>{close.status}</StatusPill></td><td>{close.variance ?? "—"}</td></tr>) : <tr><td colSpan={4} className="empty-cell">No daily closes recorded.</td></tr>}</tbody></table></div></article>
    </section>
    {showTask ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Work queue</p><h2>Create operational task</h2><form onSubmit={(event) => { event.preventDefault(); void createTask(new FormData(event.currentTarget)); }} className="invite-form">{taskCreationMessage ? <div role="alert"><p>{taskCreationMessage}</p>{taskCreationUncertain ? <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload task list</button> : null}</div> : null}<label>Facility<select name="facilityId" required><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowTask(false)}>Cancel</button><button className="button button-primary" disabled={busy || taskCreationUncertain || !data?.facilities.length}>{busy ? "Saving…" : "Create task"}</button></div></form></div></div> : null}
    {showMaintenance ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Unit availability</p><h2>Create maintenance request</h2><p className="panel-subtitle">Selecting a unit immediately removes it from bookable availability until all linked maintenance is complete.</p><form onSubmit={(event) => { event.preventDefault(); void createMaintenance(new FormData(event.currentTarget)); }} className="invite-form">{maintenanceMessage ? <div role="alert"><p>{maintenanceMessage}</p>{maintenanceUncertain ? <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload maintenance status</button> : null}</div> : null}<label>Facility<select name="facilityId" required value={maintenanceFacilityId} onChange={(event) => setMaintenanceFacilityId(event.target.value)}><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Unit (optional)<select name="unitId" defaultValue=""><option value="">Facility-level request</option>{data?.facilities.find((facility) => facility.id === maintenanceFacilityId)?.units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.number}{unit.status === "SERVICE" ? " · already in service" : ""}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowMaintenance(false); setMaintenanceFacilityId(""); }}>Cancel</button><button className="button button-primary" disabled={busy || maintenanceUncertain || !maintenanceFacilityId}>{busy ? "Saving…" : "Create request"}</button></div></form></div></div> : null}
  </div>;
}
