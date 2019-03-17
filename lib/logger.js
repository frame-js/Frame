'use strict'

function log() {
  // eslint-disable-next-line no-console
  console.log.apply(this, arguments)
}

log.error = function() {
  // eslint-disable-next-line no-console
  console.error.apply(this, arguments)
}

log.warn = function() {
  // eslint-disable-next-line no-console
  console.warn.apply(this, arguments)
}

log.debug = function() {
  console.log.apply(this, arguments)
}

export default log
