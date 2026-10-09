import test from "node:test";
import assert from "node:assert/strict";
import {approvedMerchandise} from "../src/lib/approved-merchandise-catalogue";
test("approved catalogue keeps eight distinct sell units and supplied VAT-inclusive prices",()=>{assert.equal(new Set(approvedMerchandise.map(p=>p.sku)).size,8);assert.deepEqual(approvedMerchandise.map(p=>p.sellingPrice),[50,35,899,23,29,29,200,170]);assert.equal(approvedMerchandise.find(p=>p.sku==="ST24-WRAP-BUBBLE-1M")?.costPrice,null);});
