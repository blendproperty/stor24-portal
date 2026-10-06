/** Actual components with invented responses. No production connections or customer/finance writes. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const cid = "c" + "a".repeat(24),
  lid = "c" + "b".repeat(24),
  today = new Date(Date.now() + 7200000).toISOString().slice(0, 10);
const campaign = {
  id: cid,
  facilityId: "fixture",
  name: "Example launch campaign",
  source: "google",
  medium: "cpc",
  budget: 5000,
  status: "ACTIVE",
  version: 1,
  startsAt: today + "T00:00:00Z",
  endsAt: null,
  createdAt: today + "T00:00:00Z",
  links: [
    {
      id: lid,
      campaignId: cid,
      label: "Search creative A",
      landingPage: "/",
      keyword: null,
      url: `https://stor24.co.za/?utm_source=google&utm_medium=cpc&utm_campaign=${cid}&utm_content=${lid}`,
      createdAt: today + "T00:00:00Z",
    },
  ],
  activities: [
    {
      id: "activity",
      campaignId: cid,
      title: "Search launch",
      version: 1,
      kind: "ADVERTISING",
      occurredAt: today + "T10:00:00Z",
      spend: 1200,
      impressions: 15000,
      clicks: 360,
      notes: "Invented browser fixture",
      createdById: "fixture",
      createdAt: today + "T10:00:00Z",
    },
  ],
};
const workspace = {
  facilities: [
    { id: "fixture", name: "Training store" },
    { id: "second", name: "Second training store" },
  ],
  count: 12,
  limited: false,
  campaigns: [campaign],
  leads: Array.from({ length: 12 }, (_, i) => ({
    id: "lead" + i,
    facilityId: "fixture",
    createdAt: today + "T10:00:00Z",
    source: "Website",
    won: i < 3,
    reserved: i === 3,
    stage: i < 3 ? "WON" : "NEW",
    attribution:
      i < 10
        ? {
            source: "google",
            medium: "cpc",
            campaignId: cid,
            linkId: lid,
            landingPage: "/",
            conversionPage: "/book",
          }
        : null,
  })),
};
const bundle = await build({
  entryPoints: ["tests/browser/marketing-fixture.jsx"],
  bundle: true,
  write: false,
  format: "esm",
  jsx: "automatic",
  plugins: [
    {
      name: "actions",
      setup(b) {
        b.onResolve({ filter: /^@\/app\/actions\// }, (a) => ({
          path: a.path,
          namespace: "actions",
        }));
        b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({
          contents:
            "export async function confirmReservationMoveInAction(){throw Error('Unexpected handover')} export async function recordReservationPaymentAction(){throw Error('Unexpected payment')}",
        }));
      },
    },
  ],
});
const css = (
  await Promise.all(
    [
      "src/app/globals.css",
      "src/styles/stor24-brand.css",
      "src/styles/staff-workspace.css",
      "src/styles/marketing.css",
    ].map((p) => readFile(p, "utf8")),
  )
)
  .join("\n")
  .replace('@import "tailwindcss";', "");
const requests = [];
let advertisingFailures = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/brand/Satoshi-Variable.ttf") {
    res.setHeader("content-type", "font/ttf");
    return res.end(await readFile("public/brand/Satoshi-Variable.ttf"));
  }
  if (req.url === "/fixture.js") {
    res.setHeader("content-type", "text/javascript");
    return res.end(bundle.outputFiles[0].text);
  }
  if (req.url === "/fixture.css") {
    res.setHeader("content-type", "text/css");
    return res.end(
      css +
        "\n.app-shell{display:block}.app-shell .content{max-width:1400px;padding:32px;margin:auto}.app-shell .move-in-navigation{left:24px;right:24px}@font-face{font-family:Satoshi;src:url(/brand/Satoshi-Variable.ttf);font-weight:300 900}body{background:#f1f5f8;--font-satoshi:Satoshi;font-family:Satoshi,Arial,sans-serif} @media(max-width:650px){.app-shell .content{padding:16px}.app-shell .move-in-navigation{left:12px;right:12px}}",
    );
  }
  if (req.url === "/api/v1/marketing/connection") {
    assert.equal(req.method, "POST");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    assert.match(input.token, /^synthetic-only-/);
    res.setHeader("content-type", "application/json");
    res.statusCode = input.token.includes("fail") ? 503 : 200;
    return res.end(JSON.stringify(res.statusCode === 503 ? {error:{message:"Synthetic provider unavailable"}} : {data:{configured:true}}));
  }
  if (req.url.startsWith("/api/v1/marketing/advertising")) {
    res.setHeader("content-type", "application/json");
    if (advertisingFailures > 0) {
      advertisingFailures -= 1;
      res.statusCode = 503;
      return res.end(JSON.stringify({error:{message:"Synthetic advertising outage"}}));
    }
    return res.end(JSON.stringify({ data: [
      { provider: "Google Ads", status: "connected", message: "Verified STOR24 campaign fixture", retrievedAt: new Date().toISOString(), rows: [{provider:"Google Ads",campaignId:"24315692802",name:"=Synthetic campaign",date:today,currency:"ZAR",spend:150,impressions:1000,clicks:20,conversions:2}] },
      { provider: "Meta Ads", status: "unconfigured", message: "Company-managed reporting access required", retrievedAt:null, rows:[] }
    ] }));
  }
  if (req.url.startsWith("/api/v1/marketing/traffic")) {
    res.setHeader("content-type", "application/json");
    return res.end(
      JSON.stringify({
        data: {
          status: "unconfigured",
          message: "Fixture reporting connection not configured",
          days: [],
          totals: null,
        },
      }),
    );
  }
  if (req.url === "/api/v1/marketing") {
    res.setHeader("content-type", "application/json");
    if (req.method !== "GET") {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      res.statusCode = requests.at(-1).name === "Fail test" ? 503 : 201;
      return res.end(
        JSON.stringify(
          res.statusCode === 503
            ? { error: { message: "Fixture save unavailable. Please retry." } }
            : { data: { id: cid } },
        ),
      );
    }
    return res.end(JSON.stringify({ data: workspace }));
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.env.PREVIEW_ONLY) {
  console.log("Marketing preview: " + base);
} else {
  const browser = await chromium.launch();
  try {
    await mkdir("output/marketing", { recursive: true });
    for (const width of [1440, 1024, 768, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/settings/advertising");
      await expect(page.getByRole("heading",{name:"Website traffic: Google Analytics"})).toBeVisible();
      await expect(page.getByRole("link",{name:/Enable the Google Analytics/})).toHaveAttribute("href","https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=synthetic-company-project");
      await page.getByLabel("Meta reporting access token").fill("synthetic-only-fail-" + "a".repeat(32));
      await page.getByRole("button", {name:"Verify and connect"}).click();
      await expect(page.getByRole("status")).toContainText("Synthetic provider unavailable");
      await expect(page.getByLabel("Meta reporting access token")).toHaveValue("synthetic-only-fail-" + "a".repeat(32));
      await page.getByLabel("Meta reporting access token").fill("synthetic-only-success-" + "a".repeat(32));
      await page.getByRole("button", {name:"Verify and connect"}).click();
      await expect(page.getByRole("status")).toContainText("connected and verified");
      await expect(page.getByLabel("Meta reporting access token")).toHaveValue("");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `connection overflow ${width}`);
      await page.screenshot({path:`output/marketing/advertising-connection-${width}.png`,fullPage:true});
      if (width === 1440) advertisingFailures = 1;
      await page.goto(base);
      await expect(
        page.getByRole("heading", {
          name: "Marketing command centre",
          exact: true,
        }),
      ).toBeVisible();
      if (width === 1440) {
        await expect(page.getByRole("alert")).toContainText("Advertising could not load");
        await page.getByRole("button", {name:"Refresh marketing",exact:true}).click();
      }
      await expect(page.getByRole("heading", {name:/Google Ads.*Connected/})).toBeVisible();
      await expect(page.getByRole("heading", {name:/Meta Ads.*Connection needed/})).toBeVisible();
      await expect(page.getByRole("button", {name:"Export Meta Ads"})).toBeDisabled();
      if (width === 1440) {
        const downloaded = page.waitForEvent("download");
        await page.getByRole("button", {name:"Export Google Ads"}).click();
        const file = await downloaded;
        const report = await readFile(await file.path(), "utf8");
        assert.ok(report.includes("24315692802"));
        assert.ok(report.includes("'=Synthetic campaign"));
        assert.ok(report.includes("ZAR"));
      }
      await expect(
        page.locator(".marketing-kpis article").first(),
      ).toContainText("12");
      for (const tab of [
        "overview",
        "channels",
        "budgets",
        "placements",
        "calendar",
        "campaigns",
        "tracked links",
        "activity",
      ]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${tab} overflow ${width}`,
        );
        if (width === 1440) {
          const completed = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Export", exact: true })
            .click();
          const exported = await completed;
          const file = await exported.path();
          const csv = await readFile(file, "utf8");
          const headers = {
            channels: "Channel",
            budgets: "Lifetime budget ZAR",
            placements: "Placement",
            calendar: "SAST day",
            activity: "SAST day",
            "tracked links": "Tracking URL",
          };
          assert.ok(
            csv.includes(headers[tab] ?? "Campaign"),
            `correct ${tab} export`,
          );
          assert.ok(
            exported.suggestedFilename().includes(tab.replaceAll(" ", "-")),
          );
        }
        await page.screenshot({
          path: `output/marketing/${tab.replaceAll(" ", "-")}-${width}.png`,
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "channels", exact: true }).click();
      await expect(page.getByRole("cell", { name: /3[,.]33/ })).toBeVisible();
      await page.getByLabel("Campaign", { exact: true }).selectOption(cid);
      await expect(
        page.getByText("Cost per enquiry", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "budgets", exact: true }).click();
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "value",
        "1200",
      );
      await page
        .getByRole("button", { name: "placements", exact: true })
        .click();
      await page.getByLabel("Find placement").fill("no match");
      await expect(
        page.getByRole("cell", { name: "Search creative A", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Find placement").fill("Search creative");
      await expect(
        page.getByRole("cell", { name: "Search creative A", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "calendar", exact: true }).click();
      await expect(
        page.getByText("Search launch", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "New campaign" }).click();
      await page.getByLabel("Campaign name").fill("Fail test");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("save unavailable");
      await expect(page.getByLabel("Campaign name")).toHaveValue("Fail test");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `modal overflow ${width}`,
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "campaigns", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit campaign", exact: true })
        .click();
      await expect(page.getByLabel("Campaign name")).toHaveValue(campaign.name);
      await page.getByLabel("Campaign name").fill("Corrected fixture campaign");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(requests.at(-1).campaignId, cid);
      assert.equal(requests.at(-1).version, 1);
      await page
        .getByRole("button", { name: "tracked links", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create link", exact: true })
        .click();
      await page
        .getByLabel("Placement / creative name")
        .fill("Fixture creative");
      await page.getByLabel("Landing page").selectOption("/book");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(requests.at(-1).landingPage, "/book");
      await page.getByRole("button", { name: "activity", exact: true }).click();
      await page
        .getByRole("button", { name: "Log activity", exact: true })
        .click();
      await page.getByLabel("Activity title").fill("Fixture event");
      await page.getByLabel("Spend (ZAR)").fill("123.45");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(requests.at(-1).spend, 123.45);
      await page
        .getByRole("button", { name: "Edit activity", exact: true })
        .click();
      await expect(page.getByLabel("Spend (ZAR)")).toHaveValue("1200");
      await page.getByLabel("Spend (ZAR)").fill("1000");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(requests.at(-1).activityId, "activity");
      assert.equal(requests.at(-1).version, 1);
      await page.locator(".marketing-filters select").selectOption("second");
      await expect(
        page.locator(".marketing-kpis article").first(),
      ).toContainText("0");
      await page.locator(".marketing-filters select").selectOption("");
      await page.getByRole("button", { name: "New campaign" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "New campaign" }),
      ).toBeFocused();
      await page.goto(base + "?restricted");
      await expect(
        page.getByRole("button", { name: "New campaign" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "tracked links", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Create link" }),
      ).toHaveCount(0);
      await page.goto(base + "/move-in");
      await expect(page.locator(".move-in-selection")).toContainText(
        "Choose a unit to continue",
      );
      await expect(page.locator(".move-in-selection")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expect(
        page.getByRole("button", { name: "Next", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("radio", { name: "Select unit 12", exact: true })
        .check();
      await expect(page.locator(".move-in-selection")).toContainText("Unit 12");
      await expect(
        page.getByRole("button", { name: "Next", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: `output/marketing/move-in-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `move-in overflow ${width}`,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.equal(requests.length, 25);
    assert.equal(
      requests.filter((r) => r.kind === "campaign" && r.name === "Fail test")
        .length,
      5,
    );
    console.log(
      "Marketing tabs, failed-save retention, restricted controls and move-in CTA pass at five widths. All writes were intercepted invented campaign tests.",
    );
  } finally {
    await browser.close();
    server.close();
  }
}
