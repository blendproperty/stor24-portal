import test from "node:test";
import assert from "node:assert/strict";
import { effectiveUseTypes, unitSupportsProduct, productLineFromRequest } from "../src/lib/product-line";
import { publicReservationSchema } from "../src/lib/public-booking-contract";
test("product inheritance, override and one shared unit",()=>{const u={floor:"Ground Floor",unitType:{useTypes:["STORAGE","MICRO_WAREHOUSE"]},useTypesOverride:[]};assert.deepEqual(effectiveUseTypes(u),["STORAGE","MICRO_WAREHOUSE"]);assert.equal(unitSupportsProduct(u,"MICRO_WAREHOUSE"),true);assert.equal(unitSupportsProduct({...u,useTypesOverride:["MICRO_WAREHOUSE"]},"STORAGE"),false);assert.equal(unitSupportsProduct({...u,unitType:{useTypes:["STORAGE"]}},"MICRO_WAREHOUSE"),false);});
test("micro warehousing excludes upper, unknown and conflicting mapped floors",()=>{for(const floor of ["1","First Floor",null])assert.equal(unitSupportsProduct({floor,unitType:{useTypes:["MICRO_WAREHOUSE"]}},"MICRO_WAREHOUSE"),false);assert.equal(unitSupportsProduct({floor:"Ground Floor",mapElements:[{map:{name:"First Floor"}}],unitType:{useTypes:["MICRO_WAREHOUSE"]}},"MICRO_WAREHOUSE"),false);assert.equal(unitSupportsProduct({floor:null,mapElements:[{map:{name:"Ground Floor"}}],unitType:{useTypes:["MICRO_WAREHOUSE"]}},"MICRO_WAREHOUSE"),true);});
test("request accepts only supported product lines",()=>{assert.equal(productLineFromRequest(new Request("https://test/api")),"STORAGE");assert.equal(productLineFromRequest(new Request("https://test/api?useType=MICRO_WAREHOUSE")),"MICRO_WAREHOUSE");assert.equal(productLineFromRequest(new Request("https://test/api?useType=invalid")),null);});
test("business reservation requires business name without changing storage contract",()=>{const input={facilitySlug:"midpoint",unitId:"unit",firstName:"Test",lastName:"Person",email:"test@example.com",phone:"0123456789",idempotencyKey:"1234567890123456"};assert.equal(publicReservationSchema.safeParse(input).success,true);assert.equal(publicReservationSchema.safeParse({...input,productLine:"MICRO_WAREHOUSE"}).success,false);assert.equal(publicReservationSchema.safeParse({...input,productLine:"MICRO_WAREHOUSE",businessDetails:{companyName:"Test business"}}).success,true);});

import { businessAttributesSchema } from "../src/lib/validators";
test("business attributes preserve unknown versus false and reject invalid dimensions",()=>{
 assert.deepEqual(businessAttributesSchema.parse({}),{});
 assert.deepEqual(businessAttributesSchema.parse({hasPower:false,doorWidthMm:2500,privateKey:'excluded'}),{hasPower:false,doorWidthMm:2500});
 for(const doorWidthMm of [-1,0,1.5,25000])assert.equal(businessAttributesSchema.safeParse({doorWidthMm}).success,false);
 assert.equal(businessAttributesSchema.safeParse({hasPower:'yes'}).success,false);
});
