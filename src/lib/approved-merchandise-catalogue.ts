// Owner-supplied merchandise sheet, 8 October 2026. Retail amounts include VAT;
// product costs use the supplied ex-VAT column. No physical count was supplied.
export const approvedMerchandise = [
 {sku:"ST24-BOX-STOCK7",name:"Stock 7 box · 450 × 450 × 500 mm",category:"Moving boxes",costPrice:25.21,sellingPrice:50},
 {sku:"ST24-BOX-STOCK5",name:"Stock 5 box · 443 × 296 × 299 mm",category:"Moving boxes",costPrice:20,sellingPrice:35},
 {sku:"ST24-WRAP-BUBBLE-BULK",name:"Bubble wrap",category:"Protection materials",costPrice:478.26,sellingPrice:899},
 // The sheet repeats the bulk cost for per-metre wrap. Retain unknown cost until confirmed.
 {sku:"ST24-WRAP-BUBBLE-1M",name:"Bubble wrap per metre · 1.2 m × 1 m",category:"Protection materials",costPrice:null,sellingPrice:23},
 {sku:"ST24-MARKER-BLACK",name:"Permanent marker",category:"Packing accessories",costPrice:17.40,sellingPrice:29},
 {sku:"ST24-TAPE-50M",name:"Packing tape · 50 m",category:"Packing accessories",costPrice:17.40,sellingPrice:29},
 {sku:"ST24-LOCK-DISC-70",name:"Disc lock · 70 mm",category:"Padlocks",costPrice:100,sellingPrice:200},
 {sku:"ST24-LOCK-BRASS-50",name:"Brass padlock · 50 mm",category:"Padlocks",costPrice:65.21,sellingPrice:170},
] as const;
