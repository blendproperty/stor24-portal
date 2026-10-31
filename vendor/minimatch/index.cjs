// Keep callable CommonJS consumers on the backported upstream engine.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy callers require synchronous CommonJS.
const api = require('./dist/commonjs/index.js');
module.exports = Object.assign(api.minimatch, api);
