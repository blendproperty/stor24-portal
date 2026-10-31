// Keep callable CommonJS consumers on the backported upstream engine.
const api = require('./dist/commonjs/index.js');
module.exports = Object.assign(api.minimatch, api);
