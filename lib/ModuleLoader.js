// TODO: ModuleFactory() for loader, which passes the loader + protocol into it.. That way it's recursive...

function Module(__filename, fileContents, callback) {
  // From iife code
  if (!fileContents)
    __filename = __filename.path || ''

  var module = {
    filename: __filename,
    exports: {},
    Blueprint: null,
    resolve: {},

    require: function(url, callback) {
      let filePath

      if (url.indexOf('./') !== -1) {
        filePath = url
      } else {
        filePath = '../node_modules/' + url
      }

      return window.http.module.in.call(window.http.module, filePath, null, callback, true)
    },
  }

  if (!callback)
    return module

  module.resolve[module.filename] = function(exports) {
    callback(null, exports)
    delete module.resolve[module.filename]
  }

  const script = 'module.resolve["' + __filename + '"](function(iifeModule){\n' +
  '  var module = Module(iifeModule)\n' +
  '  var __filename = module.filename\n' +
  '  var __dirname = __filename.slice(0, __filename.lastIndexOf("/"))\n' +
  '  var require = module.require\n' +
  '  var exports = module.exports\n' +
  '  var process = { browser: true }\n' +
  '  var Blueprint = null;\n\n' +

  '(function() {\n' + // Create IIFE for module/blueprint
  '"use strict";\n' +
    fileContents + '\n' +
  '}).call(module.exports);\n' + // Create 'this' binding.
  '  if (Blueprint) { return Blueprint}\n' +
  '  return module.exports\n' +
  '}(module));'

  window.module = module
  window.global = window
  window.Module = Module

  window.require = module.require

  return script
}

export default Module
