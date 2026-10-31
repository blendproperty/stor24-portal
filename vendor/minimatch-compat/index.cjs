"use strict";
// ESLint plugins still call the pre-v9 default export; keep that API on patched upstream code.
const core = require("minimatch-core");
module.exports = Object.assign(core.minimatch, core);
