import test from "node:test";
import assert from "node:assert/strict";
import { launchAdvertising, advertisingFromSearch, validAdvertising, advertisingMatches } from "../src/lib/advertising-attribution";

test("every approved launch creative retains only its verified platform metadata and purchased keyword", () => {
  for (const [campaign, entry] of Object.entries(launchAdvertising)) {
    for (const [content, ad] of Object.entries(entry.ads)) {
      const query = new URLSearchParams({utm_source:entry.source,utm_medium:entry.medium,utm_campaign:campaign,utm_content:content,...(entry.source==="google"?{utm_id:entry.id}:{}),utm_term:entry.keywords[0]??"private@example.invalid",email:"private@example.invalid"});
      const parsed = advertisingFromSearch(query.toString())!;
      assert.ok(parsed);
      assert.equal(parsed.campaign,campaign); assert.equal(parsed.campaignId,entry.id);
      assert.equal(parsed.content,content); assert.equal(parsed.adId,ad.adId);
      assert.equal(parsed.adGroupId,ad.adGroupId); assert.equal(parsed.adSetId,ad.adSetId);
      assert.equal(parsed.term,entry.keywords[0]);
      assert.ok(validAdvertising(parsed)); assert.ok(advertisingMatches(parsed,entry.source,entry.medium));
      assert.equal(JSON.stringify(parsed).includes("private"),false);
      assert.equal(validAdvertising({...parsed,email:"private@example.invalid"}),false);
      assert.equal(validAdvertising({...parsed,adId:"other-ad"}),false);
      assert.equal(advertisingFromSearch(query.toString()+"&utm_id=wrong"),undefined);
    }
  }
});

test("unknown, mixed-platform, mismatched and identifying tags fail closed without raw text", () => {
  const base="utm_source=google&utm_medium=cpc&utm_campaign=stor24_midrand_search";
  assert.deepEqual(advertisingFromSearch(base+"&utm_content=private@example.invalid&utm_term=private@example.invalid"),{campaign:"stor24_midrand_search",campaignId:"24315694704"});
  for (const query of ["utm_campaign=private@example.invalid",base.replace("google","facebook"),base.replace("cpc","social"),base+"&utm_id=24315692802",base.replace("stor24_midrand_search","__proto__")]) assert.equal(advertisingFromSearch(query),undefined);
  assert.equal(validAdvertising({campaign:"__proto__",campaignId:"x"}),false);
});

import { leadAttributionSchema } from "../src/lib/lead-attribution";
import { publicLeadSchema } from "../src/lib/public-lead-contract";
import { marketingReport } from "../src/lib/marketing-reporting";
test("micro journeys survive the public contract and campaign reporting remains scoped",()=>{
 const advertising=advertisingFromSearch("utm_source=facebook&utm_medium=paid_social&utm_campaign=stor24_micro_warehousing_round2_20261015&utm_content=micro-carousel-4")!;
 const attribution={version:1,consent:"granted",source:"facebook",medium:"paid_social",method:"utm",landingPage:"/micro-warehousing",conversionPage:"/micro-warehousing/book",pages:["/micro-warehousing","/micro-warehousing/midpoint","/micro-warehousing/book"],advertising};
 assert.equal(leadAttributionSchema.safeParse(attribution).success,true);
 const input={firstName:"Synthetic",lastName:"Launch",email:"launch@example.invalid",phone:"0000000000",attribution};
 assert.deepEqual(publicLeadSchema.parse(input).attribution,attribution);
 assert.equal(leadAttributionSchema.safeParse({...attribution,source:"google"}).success,false);
 assert.equal(leadAttributionSchema.safeParse({...attribution,landingPage:"/micro-warehousing/book?email=private@example.invalid"}).success,false);
 const lead={facilityId:"one",createdAt:"2026-10-30T10:00:00Z",source:"Website",won:false,reserved:false,attribution:leadAttributionSchema.parse(attribution)};
 const report=marketingReport([lead,{...lead,facilityId:"two"}],[],"2026-10-30","2026-10-30","one");assert.equal(report.advertising.length,1);assert.equal(report.advertising[0].leads,1);assert.equal(report.advertising[0].content,"micro-carousel-4");
});
