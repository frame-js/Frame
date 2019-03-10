import log from '../../lib/logger'
import Module from '../../lib/ModuleLoader'

// Embedded http loader blueprint.
const httpLoader = {
  name: 'loaders/http',
  protocol: 'loader', // embedded loader

  // Internals for embed
  loaded: true,
  callbacks: [],

  module: {
    name: 'HTTP Loader',
    protocol: ['http', 'https', 'web://'], // TODO: Create a way for loader to subscribe to multiple protocols

    init: function() {
      this.isBrowser = (typeof window === 'object') ? true : false
    },

    in: function(fileName, opts, callback) {
      if (!this.isBrowser)
        return callback('URL loading with node.js not supported yet (Coming soon!).')

      return this.browser.load.call(this, fileName, callback)
    },

    normalizeFilePath: function(fileName) {
      if (fileName.indexOf('http') >= 0)
        return fileName

      let file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '')
      file = 'blueprints/' + file
      return file
    },

    browser: {
      load: function(fileName, callback) {
        const filePath = this.normalizeFilePath(fileName)
        log('[http loader] Loading file: ' + filePath)

        var async = true
        var syncFile = null
        if (!callback) {
          async = false
          callback = function(err, file) {
            if (err)
              throw new Error(err)

            return syncFile = file
          }
        }

        const scriptRequest = new XMLHttpRequest()

        // TODO: Needs validating that event handlers work across browsers. More specifically, that they run on ES5 environments.
        // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#Browser_compatibility
        const scriptEvents = new this.browser.scriptEvents(this, fileName, callback)
        scriptRequest.addEventListener('load', scriptEvents.onLoad)
        scriptRequest.addEventListener('error', scriptEvents.onError)

        scriptRequest.open('GET', filePath, async)
        scriptRequest.send(null)

        return syncFile
      },

      scriptEvents: function(loader, fileName, callback) {
        this.callback = callback
        this.fileName = fileName
        this.onLoad = loader.browser.onLoad.call(this, loader)
        this.onError = loader.browser.onError.call(this, loader)
      },

      onLoad: function(loader) {
        const scriptEvents = this
        return function() {
          const scriptRequest = this

          if (scriptRequest.status > 400)
            return scriptEvents.onError.call(scriptRequest, scriptRequest.statusText)

          const scriptContent = Module(scriptRequest.responseURL, scriptRequest.responseText, scriptEvents.callback)

          var html = document.documentElement
          var scriptTag = document.createElement('script')
          scriptTag.textContent = scriptContent

          html.appendChild(scriptTag)
          loader.browser.cleanup(scriptTag, scriptEvents)
        }
      },

      onError: function(loader) {
        const scriptEvents = this
        const fileName = scriptEvents.fileName

        return function() {
          const scriptTag = this
          loader.browser.cleanup(scriptTag, scriptEvents)

          // Try to fallback to index.js
          // FIXME: instead of falling back, this should be the default if no `.js` is detected, but URL uglifiers and such will have issues.. hrmmmm..
          if (fileName.indexOf('.js') === -1 && fileName.indexOf('index.js') === -1) {
            log.warn('[http] Attempting to fallback to: ', fileName + '/index.js')
            return loader.in.call(loader, fileName + '/index.js', scriptEvents.callback)
          }

          scriptEvents.callback('Could not load Blueprint')
        }
      },

      cleanup: function(scriptTag, scriptEvents) {
        scriptTag.removeEventListener('load', scriptEvents.onLoad)
        scriptTag.removeEventListener('error', scriptEvents.onError)
        //document.getElementsByTagName('head')[0].removeChild(scriptTag) // TODO: Cleanup
      },
    },

    node: {
      // Stub for node.js HTTP loading support.
    },

  },
}

window.http = httpLoader // TODO: Cleanup, expose modules instead

export default httpLoader
