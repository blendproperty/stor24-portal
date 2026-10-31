"use strict";
// Preserve callable ESLint/glob consumers while exposing the patched upstream named APIs.
const core = require("./upstream/index.js");
module.exports = Object.assign(core.minimatch, core);
