"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { Check, ImagePlus, Minus, PackagePlus, Plus, Search, Trash2, X } from "lucide-react";

export type MerchandiseProduct = {
  id: string; facilityId: string; sku: string; name: string; category: string; barcode: string | null;
  imageUrl: string | null; costPrice: string; quantityOnHand: number; quantityReserved: number;
  reorderPoint: number; sellingPrice: string; active: boolean; facility: { name: string };
};

export type MerchandisePackage = {
  id: string; facilityId: string; code: string; name: string; description: string; badge: string | null;
  imageUrl: string | null; sellingPrice: string; minUnitAreaSqM: string | null; maxUnitAreaSqM: string | null;
  sortOrder: number; active: boolean; facility: { name: string };
  items: Array<{ id: string; quantity: number; product: MerchandiseProduct }>;
};

function ImagePicker({ initialValue, label }: { initialValue?: string | null; label: string }) {
  const [imageUrl, setImageUrl] = useState(initialValue ?? "");
  const [message, setMessage] = useState("");

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Choose a JPG, PNG or WebP image."); return; }
    if (file.size > 2_000_000) { setMessage("Keep the image below 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setImageUrl(String(reader.result)); setMessage(""); };
    reader.readAsDataURL(file);
  }

  return <div className="merch-image-picker">
    <input type="hidden" name="imageUrl" value={imageUrl}/>
    <div className={`merch-image-preview ${imageUrl ? "has-image" : ""}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>
      {!imageUrl ? <><ImagePlus size={28}/><strong>Add an image</strong><span>JPG, PNG or WebP · max 2 MB</span></> : null}
    </div>
    <div className="merch-image-actions">
      <label className="button button-secondary"><ImagePlus size={15}/>{imageUrl ? "Replace image" : `Upload ${label}`}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage}/></label>
      {imageUrl ? <button type="button" className="text-button text-button-danger" onClick={() => setImageUrl("")}><Trash2 size={14}/> Remove</button> : null}
    </div>
    {message ? <p className="form-error">{message}</p> : null}
  </div>;
}

export function ProductEditorModal({ product, busy, close, save }: { product: MerchandiseProduct; busy: boolean; close: () => void; save: (data: FormData) => void | Promise<void> }) {
  return <div className="modal-backdrop"><div className="modal-card merch-editor merch-product-editor" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
    <button type="button" className="modal-close" onClick={close} aria-label="Close"><X size={18}/></button>
    <div className="merch-editor-heading"><div><p className="eyebrow">Merchandise catalogue</p><h2 id="product-editor-title">{product.name}</h2><p>{product.facility.name} · {product.quantityOnHand - product.quantityReserved} ready to sell</p></div><span className="merch-sku">{product.sku}</span></div>
    <form action={save} className="merch-editor-form">
      <div className="merch-editor-layout">
        <aside><ImagePicker initialValue={product.imageUrl} label="product image"/><div className="merch-stock-card"><span>Available stock</span><strong>{product.quantityOnHand - product.quantityReserved}</strong><small>Use Move stock for audited corrections.</small></div></aside>
        <div className="merch-fields"><div className="form-grid two"><label>SKU<input name="sku" required maxLength={60} defaultValue={product.sku}/></label><label>Product name<input name="name" required maxLength={160} defaultValue={product.name}/></label><label>Category<input name="category" required defaultValue={product.category}/></label><label>Barcode<input name="barcode" defaultValue={product.barcode ?? ""}/></label><label>Cost price<span className="money-input"><b>R</b><input name="costPrice" type="number" min="0" step="0.01" defaultValue={product.costPrice} required/></span></label><label>Selling price<span className="money-input"><b>R</b><input name="sellingPrice" type="number" min="0" step="0.01" defaultValue={product.sellingPrice} required/></span></label><label>Reorder point<input name="reorderPoint" type="number" min="0" step="1" defaultValue={product.reorderPoint} required/></label></div><label className="premium-switch"><input name="active" type="checkbox" defaultChecked={product.active}/><span><Check size={14}/></span><strong>Active product<small>Available for packages and sales</small></strong></label></div>
      </div>
      <div className="merch-editor-footer"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save product"}</button></div>
    </form>
  </div></div>;
}

export function PackageEditorModal({ storagePackage, products, busy, close, save, mode = "edit" }: { storagePackage: MerchandisePackage; products: MerchandiseProduct[]; busy: boolean; close: () => void; save: (data: FormData) => void | Promise<void>; mode?: "create" | "edit" }) {
  const facilityProducts = useMemo(() => products.filter((product) => product.facilityId === storagePackage.facilityId && product.active), [products, storagePackage.facilityId]);
  const initial = Object.fromEntries(storagePackage.items.map((item) => [item.product.id, item.quantity]));
  const [quantities, setQuantities] = useState<Record<string, number>>(initial);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const selected = facilityProducts.filter((product) => (quantities[product.id] ?? 0) > 0);
  const categories = Array.from(new Set(facilityProducts.map((product) => product.category))).sort();
  const visibleProducts = facilityProducts.filter((product) => (category === "ALL" || product.category === category) && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
  const itemTotal = selected.reduce((sum, product) => sum + Number(product.sellingPrice) * quantities[product.id], 0);
  const setQuantity = (id: string, value: number) => setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.floor(value || 0)) }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    for (const product of selected) form.set(`quantity:${product.id}`, String(quantities[product.id]));
    save(form);
  }

  return <div className="modal-backdrop"><div className="modal-card merch-editor merch-package-editor" role="dialog" aria-modal="true" aria-labelledby="package-editor-title">
    <button type="button" className="modal-close" onClick={close} aria-label="Close"><X size={18}/></button>
    <div className="merch-editor-heading"><div><p className="eyebrow">Package studio</p><h2 id="package-editor-title">{mode === "create" ? "Build a new package" : `Edit ${storagePackage.name}`}</h2><p>{storagePackage.facility.name} · {mode === "create" ? "Bundle the right products for the right-sized space." : "Existing bookings keep their original snapshot."}</p></div>{storagePackage.code ? <span className="merch-sku">{storagePackage.code}</span> : null}</div>
    <form onSubmit={submit} className="merch-editor-form">
      <div className="package-studio-grid">
        <section className="package-identity-card"><ImagePicker initialValue={storagePackage.imageUrl} label="package image"/><div className="package-core-fields"><div className="form-grid two"><label>Public name<input name="name" required defaultValue={storagePackage.name}/></label><label>Internal code<input name="code" required defaultValue={storagePackage.code}/></label><label>Badge<input name="badge" defaultValue={storagePackage.badge ?? ""} placeholder="Most popular"/></label><label>Once-off price<span className="money-input"><b>R</b><input name="sellingPrice" type="number" min="0" step="0.01" required defaultValue={storagePackage.sellingPrice}/></span></label><label>Ideal from<input name="minUnitAreaSqM" type="number" min="0.1" step="0.1" defaultValue={storagePackage.minUnitAreaSqM ?? ""}/><small>m² unit</small></label><label>Ideal up to<input name="maxUnitAreaSqM" type="number" min="0.1" step="0.1" defaultValue={storagePackage.maxUnitAreaSqM ?? ""}/><small>m² unit</small></label><label>Display order<input name="sortOrder" type="number" min="0" step="1" defaultValue={storagePackage.sortOrder}/></label></div><label>Description<textarea name="description" minLength={10} maxLength={500} required rows={3} defaultValue={storagePackage.description}/></label><label className="premium-switch"><input name="active" type="checkbox" defaultChecked={storagePackage.active}/><span><Check size={14}/></span><strong>Available to customers<small>Show in booking and sales channels</small></strong></label></div></section>
        <section className="package-content-studio">
          <div className="package-content-header"><div><p className="eyebrow">What’s inside</p><h3>{selected.length} products · {selected.reduce((sum, product) => sum + quantities[product.id], 0)} items</h3></div><span>Retail value R {itemTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span></div>
          <div className="selected-product-list">{selected.length ? selected.map((product) => <article className="selected-product-card" key={product.id}><div className="product-thumb" style={product.imageUrl ? { backgroundImage: `url(${product.imageUrl})` } : undefined}>{!product.imageUrl ? <PackagePlus size={20}/> : null}</div><div><strong>{product.name}</strong><small>{product.sku} · R {Number(product.sellingPrice).toFixed(2)}</small></div><div className="quantity-stepper"><button type="button" onClick={() => setQuantity(product.id, quantities[product.id] - 1)} aria-label={`Remove one ${product.name}`}><Minus size={14}/></button><input type="number" min="0" value={quantities[product.id]} onChange={(event) => setQuantity(product.id, Number(event.target.value))} aria-label={`${product.name} quantity`}/><button type="button" onClick={() => setQuantity(product.id, quantities[product.id] + 1)} aria-label={`Add one ${product.name}`}><Plus size={14}/></button></div><button type="button" className="remove-product" onClick={() => setQuantity(product.id, 0)} aria-label={`Remove ${product.name}`}><Trash2 size={16}/></button></article>) : <div className="package-empty"><PackagePlus size={28}/><strong>Build this package</strong><span>Search the catalogue below and add the right products.</span></div>}</div>
          <div className="catalogue-picker"><div className="catalogue-picker-heading"><div><h3>Choose products</h3><p>Tap a card to include or exclude it.</p></div><label className="catalogue-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search catalogue…"/></label></div><div className="package-category-pills"><button type="button" className={category === "ALL" ? "active" : ""} onClick={() => setCategory("ALL")}>All</button>{categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="product-carousel" role="list" aria-label="Products available for this package">{visibleProducts.map((product) => { const isSelected = (quantities[product.id] ?? 0) > 0; return <article className={`carousel-product-card ${isSelected ? "selected" : ""}`} key={product.id} role="listitem"><button type="button" className="carousel-product-toggle" onClick={() => setQuantity(product.id, isSelected ? 0 : 1)} aria-pressed={isSelected}><span className="carousel-check">{isSelected ? <Check size={15}/> : <Plus size={15}/>}</span><div className="carousel-product-image" style={product.imageUrl ? { backgroundImage: `url(${product.imageUrl})` } : undefined}>{!product.imageUrl ? <PackagePlus size={28}/> : null}</div><span className="carousel-product-copy"><strong>{product.name}</strong><small>{product.category}</small><b>R {Number(product.sellingPrice).toFixed(2)}</b><em>{product.quantityOnHand - product.quantityReserved} in stock</em></span></button>{isSelected ? <div className="carousel-quantity"><button type="button" onClick={() => setQuantity(product.id, quantities[product.id] - 1)}><Minus size={13}/></button><strong>{quantities[product.id]}</strong><button type="button" onClick={() => setQuantity(product.id, quantities[product.id] + 1)}><Plus size={13}/></button></div> : null}</article>; })}{!visibleProducts.length ? <p className="catalogue-empty">No products match this search.</p> : null}</div></div>
        </section>
      </div>
      <div className="merch-editor-footer"><span><strong>{selected.length} products selected</strong><small>{mode === "create" ? "Set the package price before publishing" : `Package price R ${Number(storagePackage.sellingPrice).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`}</small></span><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || !selected.length}>{busy ? "Saving…" : mode === "create" ? "Create package" : "Save package"}</button></div>
    </form>
  </div></div>;
}
