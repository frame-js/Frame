import log from '../../lib/logger'

// Embedded file loader blueprint.
const fileLoader = {
  name: 'loaders/file',
  protocol: 'embed',

  // Internals for embed
  loaded: true,
  callbacks: [],

  module: {
    name: 'File Loader',
    protocol: 'file',

    init: function() {
      this.isBrowser = (typeof window === 'object') ? true : false
    },

    in: function(fileName, callback) {
      if (this.isBrowser)
        throw new Error('File:// loading within browser not supported yet. Try relative URL instead.')

      log('[file loader] Loading file: ' + fileName)
      const file = this.normalizeFilePath(fileName)
      require(file)
      callback()
    },

    normalizeFilePath: function(fileName) {
      const path = require('path')
      return path.resolve(process.cwd(), '/../blueprints/', fileName)
    },
  },
}


export default fileLoader
