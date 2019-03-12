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

    in: function(fileName, opts, callback) {
      if (this.isBrowser)
        throw new Error('File:// loading within browser not supported yet. Try relative URL instead.')

      log('[file loader] Loading file: ' + fileName)

      // TODO: Switch to async file loading, improve require(), pass in IIFE to sandbox, use IIFE resolver for callback
      // TODO: Add error reporting.

      const vm = require('vm')
      const fs = require('fs')

      const filePath = this.normalizeFilePath(fileName)

      const file = this.resolveFile(filePath)
      if (!file)
        return callback('Blueprint not found')

      const fileContents = fs.readFileSync(file).toString()

      const sandbox = { Blueprint: null }
      vm.createContext(sandbox)
      vm.runInContext(fileContents, sandbox)

      callback(null, sandbox.Blueprint)
    },

    normalizeFilePath: function(fileName) {
      const path = require('path')
      return path.resolve(process.cwd(), 'blueprints/', fileName)
    },

    resolveFile: function(filePath) {
      const fs = require('fs')
      const path = require('path')

      // If file or directory exists
      if (fs.existsSync(filePath)) {
        // Check if blueprint is a directory first
        if (fs.statSync(filePath).isDirectory())
          return path.resolve(filePath, 'index.js')
        else
          return filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '')
      }

      // Try adding an extension to see if it exists
      const file = filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '')
      if (fs.existsSync(file))
        return file

      return false
    }
  },
}


export default fileLoader
