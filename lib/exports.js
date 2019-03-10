// Universal export function depending on environment.
// Alternatively, if this proves to be ineffective, different targets for rollup could be considered.
function exporter(name, obj) {
  // Node.js & node-like environments (export as module)
  if (typeof module === 'object' && typeof module.exports === 'object')
    module.exports = obj

  // Global export (also applied to Node + node-like environments)
  if (typeof global === 'object')
    global[name] = obj

  // UMD
  else if (typeof define === 'function' && define.amd)
    define(['exports'], function(exp) {
      exp[name] = obj
    })

  // Browsers and browser-like environments (Electron, Hybrid web apps, etc)
  else if (typeof window === 'object')
    window[name] = obj
}

export default exporter
