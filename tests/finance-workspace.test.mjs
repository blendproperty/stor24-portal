import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";

const result = await build({
  entryPoints: ["src/components/finance-workspace.tsx"], bundle: true, platform: "node", format: "cjs", write: false,
  packages: "external", jsx: "automatic",
  plugins: [{name:"fixtures", setup(build) {
    build.onResolve({filter:/^(next\/link|@\/lib\/auth-guards)$/}, args => ({path:args.path, namespace:"fixture"}));
    build.onLoad({filter:/.*/, namespace:"fixture"}, args => ({contents: args.path === "next/link"
      ? 'const React=require("react"); module.exports=({href,children,...props})=>React.createElement("a",{href,...props},children);'
      : 'exports.requirePermission=async permission=>{globalThis.requestedPermission=permission; return globalThis.financeAuth};', loader:"js", resolveDir:process.cwd()}));
  }}],
});
const fixture = new Module(path.join(process.cwd(), "finance-fixture.cjs"));
fixture.filename = path.join(process.cwd(), "finance-fixture.cjs");
fixture.paths = Module._nodeModulePaths(process.cwd());
fixture._compile(result.outputFiles[0].text, fixture.filename);
const { FinanceWorkspace } = fixture.exports;

test("finance workspaces show only available workflows and require their own permission", async () => {
  globalThis.financeAuth = {role:"Staff", permissions:["billing.view"]};
  const invoices = renderToStaticMarkup(await FinanceWorkspace({kind:"invoicing"}));
  assert.equal(globalThis.requestedPermission,"billing.view");
  assert.match(invoices,/Monthly billing/);
  assert.doesNotMatch(invoices,/Rent reviews/);
  assert.doesNotMatch(invoices,/Customer accounts and payments/);
  globalThis.financeAuth = {role:"Staff", permissions:["payments.view","ledger.view"]};
  const payments = renderToStaticMarkup(await FinanceWorkspace({kind:"payments"}));
  assert.equal(globalThis.requestedPermission,"payments.view");
  assert.match(payments,/Customer accounts and payments/);
  assert.match(payments,/Netcash operations/);
  assert.doesNotMatch(payments,/Monthly billing/);
  assert.doesNotMatch(payments,/Settlement reconciliation/);
});

