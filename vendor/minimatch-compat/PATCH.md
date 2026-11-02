# minimatch compatibility and security backport

Upstream npm minimatch10.2.6, published package commonjs files and declarations; original license retained. This local package preserves the old callable export required by installed ESLint plugins and the named/class/regex APIs used by existing glob consumers.

Backport of upstream commit77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8 (GHSA-g3hv-75wg-m249): bound first-phase **/.. splitting by braceExpandMax (default100000) and skip the quadratic second-phase dedupe above1000patterns. The default and supported matching behavior are unchanged; only optional preprocessing stops at the upstream limits. Both changed methods are in upstream/index.js. No audit waiver or renamed registry dependency is used.

Sources: https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz and https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8 .

shortcut: remove this local backport once the ESLint/glob ecosystem supports upstream minimatch11's removed makeRe/regex API; keep the bounded-child-process and actual-consumer tests until then.
