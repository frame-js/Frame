(function () {
  'use strict';

  function log() {
    // eslint-disable-next-line no-console
    console.log.apply(this, arguments);
  }

  log.error = function() {
    // eslint-disable-next-line no-console
    console.error.apply(this, arguments);
  };

  log.warn = function() {
    // eslint-disable-next-line no-console
    console.warn.apply(this, arguments);
  };

  // Universal export function depending on environment.
  // Alternatively, if this proves to be ineffective, different targets for rollup could be considered.
  function exporter(name, obj) {
    // Node.js & node-like environments (export as module)
    if (typeof module === 'object' && typeof module.exports === 'object')
      module.exports = obj;

    // Global export (also applied to Node + node-like environments)
    if (typeof global === 'object')
      global[name] = obj;

    // UMD
    else if (typeof define === 'function' && define.amd)
      define(['exports'], function(exp) {
        exp[name] = obj;
      });

    // Browsers and browser-like environments (Electron, Hybrid web apps, etc)
    else if (typeof window === 'object')
      window[name] = obj;
  }

  // Object helper functions
  function assignObject(target, source) {
    for (let propertyName of Object.getOwnPropertyNames(source)) {
      if (propertyName === 'name')
        continue

      if (typeof source[propertyName] === 'object')
        if (Array.isArray(source[propertyName]))
          target[propertyName] = [];
        else
          target[propertyName] = Object.create(source[propertyName]);
      else
        Object.defineProperty(
          target,
          propertyName,
          Object.getOwnPropertyDescriptor(source, propertyName)
        );
    }

    return target
  }

  function setDescriptor(target, value, configurable) {
    Object.defineProperty(target, 'toString', {
      enumerable: false,
      writable: false,
      configurable: true,
      value: function() {
        return (value) ? '[Frame: ' + value + ']' : '[Frame: Constructor]'
      },
    });

    Object.defineProperty(target, 'name', {
      enumerable: false,
      writable: false,
      configurable: (configurable) ? true : false,
      value: value,
    });
  }

  // Blueprint Methods
  const BlueprintMethods = {
    to: function(target) {
      addPipe.call(this, 'to', target, Array.from(arguments).slice(1));
      return this
    },

    from: function(target) {
      addPipe.call(this, 'from', target, Array.from(arguments).slice(1));
      return this
    },

    out: function(err, data) {
      if (err)
        return log.error('Error:', err)

      log('out data:', data);
      // TODO: this.next() but needs to be aware that an event can happen multiple times before other flows finish..
      // TODO: determine what happens when a Blueprint self modifies.. like in: function() { this.to( function(){} )}
    },

    error: function(err) {
      return log.error('Error:', err)
    },

    /*get value() {
      this.Frame.isPromised = true
      this.Frame.promise = new Promise()
      return this.Frame.promise
    },*/
  };

  function addPipe(direction, target, params) {
    if (!this)
      throw new Error('Blueprint method called without class, did you assign it to a variable?')

    if (!this.Frame || !this.Frame.pipes)
      throw new Error('Not working with a valid Blueprint object')

    if (typeof target !== 'function')
      throw new Error(this.Frame.name + '.to() was called with improper parameters')

    log(direction, '(): ' + this.name);
    this.Frame.pipes.push({ direction: direction, target: target, params: params });
    debounce(processFlow, 1, this);
  }

  function debounce(func, wait, blueprint) {
    let name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.call(blueprint);
    }, wait);
  }

  function processFlow() {
    // Already processing this Blueprint's flow.
    if (this.Frame.processingFlow)
      return

    // If no pipes for flow, then nothing to do.
    if (this.Frame.pipes.length < 1)
      return

    // if blueprint has not been initialized yet (i.e. constructor not used.)
    if (!this.Frame.initialized)
      return initBlueprint.call(this, processFlow)

    // TODO: loop through all blueprints in flow to make sure they have loaded and been initialized.

    this.Frame.processingFlow = true;
    log('Processing flow for ' + this.name);
  }

  function initBlueprint(callback) {
    let blueprint = this;

    try {
      const props = blueprint.Frame.props ? blueprint.Frame.props : {};

      // If Blueprint foregoes the initializer, stub it.
      if (!blueprint.init)
        blueprint.init = function(props, callback) { callback(); };

      blueprint.init.call(blueprint, props, function() {
        // Blueprint intitialzed
        log('Blueprint intialized');

        blueprint.Frame.props = {};
        blueprint.Frame.initialized = true;
        callback && callback.call(blueprint);
      });

    } catch (err) {
      throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
    }
  }

  // Internal Frame props
  const BlueprintBase = {
    loaded: false,
    initialized: false,
    processingFlow: false,
    props: {},
    flow: [],
    pipes: [],
    debounce: {},
    name: '',
  };

  // Concept based on: http://objectmodel.js.org/
  function ObjectModel(schemaObj) {
    if (typeof schemaObj === 'function') {
      return { type: schemaObj.name, expects: schemaObj }
    } else if (typeof schemaObj !== 'object')
      schemaObj = {};

    // Clone schema object so we don't mutate it.
    let schema = Object.create(schemaObj);
    Object.assign(schema, schemaObj);

    // Loop through Schema object keys
    for (let key of Object.keys(schema)) {
      // Create a schema object with types
      if (typeof schema[key] === 'function')
        schema[key] = { required: true, type: typeof schema[key]() };
      else if (typeof schema[key] === 'object' && Array.isArray(schema[key])) {
        let schemaArr = schema[key];
        schema[key] = { required: false, type: 'optional', types: [] };
        for (let schemaType of schemaArr) {
          if (typeof schemaType === 'function')
            schema[key].types.push(typeof schemaType());
        }
      } else if (typeof schema[key] === 'object' && schema[key].type) {
        schema[key] = { required: true, type: schema[key].type, expects: schema[key].expects };
      } else {
        schema[key] = { required: true, type: typeof schema[key] };
      }
    }

    // Validate schema props
    function isValidSchema(key, value) {
      // TODO: Make more flexible by defining null and undefined types.
      // No schema defined for key
      if (!schema[key])
        return true

      if (schema[key].required && typeof value === schema[key].type) {
        return true
      } else if (!schema[key].required && schema[key].type === 'optional') {
        if (value && !schema[key].types.includes(typeof value))
          return false

        return true
      } else if (schema[key].required && schema[key].type) {
        if (typeof schema[key].expects === 'function') {
          return schema[key].expects(value)
        }
      }

      return false
    }

    // Validate schema (once Schema constructor is called)
    return function validateSchema(objToValidate) {
      let proxyObj = {};
      let obj = objToValidate;

      for (let key of Object.getOwnPropertyNames(objToValidate)) {
        const propDescriptor = Object.getOwnPropertyDescriptor(objToValidate, key);

        // Property already protected
        if (!propDescriptor.writable || !propDescriptor.configurable) {
          Object.defineProperty(obj, key, propDescriptor);
          continue
        }

        // Schema does not exist for prop, passthrough
        if (!schema[key]) {
          Object.defineProperty(obj, key, propDescriptor);
          continue
        }

        proxyObj[key] = objToValidate[key];
        Object.defineProperty(obj, key, {
          enumerable: propDescriptor.enumerable,
          configurable: propDescriptor.configurable,
          get: function() {
            return proxyObj[key]
          },

          set: function(value) {
            if (!isValidSchema(key, value)) {
              if (schema[key].expects) {
                value = (typeof value === 'string') ? value : typeof value;
                throw new Error('Expecting "' + key + '" to be "' + schema[key].type + '", got "' + value + '"')
              } else if (schema[key].type === 'optional') {
                throw new Error('Expecting "' + key + '" to be one of "' + schema[key].types + '", got "' + typeof value + '"')
              } else
                throw new Error('Expecting "' + key + '" to be a "' + schema[key].type + '", got "' + typeof value + '"')
            }

            proxyObj[key] = value;
            return value
          },
        });

        obj[key] = objToValidate[key];
      }

      return obj
    }
  }

  ObjectModel.StringNotBlank = ObjectModel(function StringNotBlank(str) {
    if (typeof str !== 'string')
      return false

    return str.trim().length > 0
  });

  // Protect Blueprint using a schema
  const BlueprintSchema = new ObjectModel({
    name: ObjectModel.StringNotBlank,

    // Blueprint provides
    init: [Function],
    in: [Function],
    close: [Function],

    // Internals
    out: Function,
    error: Function,
  });

  // TODO: ModuleFactory() for loader, which passes the loader + protocol into it.. That way it's recursive...

  function Module(__filename, fileContents, callback) {
    // From iife code
    if (!fileContents)
      __filename = __filename.path || '';

    var module = {
      filename: __filename,
      exports: {},
      Blueprint: null,
      resolve: {},

      require: function(url, callback) {
        return window.http.module.in.call(window.http.module, url, callback)
      },
    };

    if (!callback)
      return module

    module.resolve[module.filename] = function(exports) {
      callback(null, exports);
      delete module.resolve[module.filename];
    };

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
    '}(module));';

    window.module = module;
    window.global = window;
    window.Module = Module;

    return script
  }

  window.require = function(url, callback) {
    window.http.module.init.call(window.http.module);
    return window.http.module.in.call(window.http.module, url, callback)
  };

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
        this.isBrowser = (typeof window === 'object') ? true : false;
      },

      in: function(fileName, opts, callback) {
        if (!this.isBrowser)
          return callback('URL loading with node.js not supported yet (Coming soon!).')

        return this.browser.load.call(this, fileName, callback)
      },

      normalizeFilePath: function(fileName) {
        if (fileName.indexOf('http') >= 0)
          return fileName

        let file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '');
        file = 'blueprints/' + file;
        return file
      },

      browser: {
        load: function(fileName, callback) {
          const filePath = this.normalizeFilePath(fileName);
          log('[http loader] Loading file: ' + filePath);

          var async = true;
          var syncFile = null;
          if (!callback) {
            async = false;
            callback = function(err, file) {
              if (err)
                throw new Error(err)

              return syncFile = file
            };
          }

          const scriptRequest = new XMLHttpRequest();

          // TODO: Needs validating that event handlers work across browsers. More specifically, that they run on ES5 environments.
          // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#Browser_compatibility
          const scriptEvents = new this.browser.scriptEvents(this, fileName, callback);
          scriptRequest.addEventListener('load', scriptEvents.onLoad);
          scriptRequest.addEventListener('error', scriptEvents.onError);

          scriptRequest.open('GET', filePath, async);
          scriptRequest.send(null);

          return syncFile
        },

        scriptEvents: function(loader, fileName, callback) {
          this.callback = callback;
          this.fileName = fileName;
          this.onLoad = loader.browser.onLoad.call(this, loader);
          this.onError = loader.browser.onError.call(this, loader);
        },

        onLoad: function(loader) {
          const scriptEvents = this;
          return function() {
            const scriptRequest = this;

            if (scriptRequest.status > 400)
              return scriptEvents.onError.call(scriptRequest, scriptRequest.statusText)

            const scriptContent = Module(scriptRequest.responseURL, scriptRequest.responseText, scriptEvents.callback);

            var html = document.documentElement;
            var scriptTag = document.createElement('script');
            scriptTag.textContent = scriptContent;

            html.appendChild(scriptTag);
            loader.browser.cleanup(scriptTag, scriptEvents);
          }
        },

        onError: function(loader) {
          const scriptEvents = this;
          const fileName = scriptEvents.fileName;

          return function() {
            const scriptTag = this;
            loader.browser.cleanup(scriptTag, scriptEvents);

            // Try to fallback to index.js
            // FIXME: instead of falling back, this should be the default if no `.js` is detected, but URL uglifiers and such will have issues.. hrmmmm..
            if (fileName.indexOf('.js') === -1 && fileName.indexOf('index.js') === -1) {
              log.warn('[http] Attempting to fallback to: ', fileName + '/index.js');
              return loader.in.call(loader, fileName + '/index.js', scriptEvents.callback)
            }

            scriptEvents.callback('Could not load Blueprint');
          }
        },

        cleanup: function(scriptTag, scriptEvents) {
          scriptTag.removeEventListener('load', scriptEvents.onLoad);
          scriptTag.removeEventListener('error', scriptEvents.onError);
          //document.getElementsByTagName('head')[0].removeChild(scriptTag) // TODO: Cleanup
        },
      },

      node: {
        // Stub for node.js HTTP loading support.
      },

    },
  };

  window.http = httpLoader; // TODO: Cleanup, expose modules instead

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
        this.isBrowser = (typeof window === 'object') ? true : false;
      },

      in: function(fileName, callback) {
        if (this.isBrowser)
          throw new Error('File:// loading within browser not supported yet. Try relative URL instead.')

        log('[file loader] Loading file: ' + fileName);
        const file = this.normalizeFilePath(fileName);
        require(file);
        callback();
      },

      normalizeFilePath: function(fileName) {
        const path = require('path');
        return path.resolve(process.cwd(), '/../blueprints/', fileName)
      },
    },
  };

  /* eslint-disable prefer-template */

  // Multi-environment async module loader
  const modules = {
    'loaders/http': httpLoader,
    'loaders/file': fileLoader,
  };

  function normalizeName(name) {
    // TODO: loop through each file path and normalize it too:
    return name.trim().toLowerCase()//.capitalize()
  }

  function resolveFileInfo(file) {
    const normalizedFileName = normalizeName(file);
    const protocol = parseProtocol(file);

    return {
      file: file,
      path: file,
      name: normalizedFileName,
      protocol: protocol,
    }
  }

  function parseProtocol(name) {
    // FIXME: name should of been normalized by now. Either remove this code or move it somewhere else..
    if (!name || typeof name !== 'string')
      throw new Error('Invalid loader blueprint name')

    var protoResults = name.match(/:\/\//gi) && name.split(/:\/\//gi);

    // No protocol found, if browser environment then is relative URL else is a file path. (Sane defaults but can be overridden)
    if (!protoResults)
      return (typeof window === 'object') ? 'http' : 'file'

    return protoResults[0]
  }

  function runModuleCallbacks(module) {
    for (let callback of module.callbacks) {
      callback(module.module);
    }

    module.callbacks = [];
  }

  const imports = function(name, opts, callback) {
    try {
      const fileInfo = resolveFileInfo(name);
      const fileName = fileInfo.name;
      const protocol = fileInfo.protocol;

      log('loading module:', fileName);

      // Module has loaded or started to load
      if (modules[fileName])
        if (modules[fileName].loaded)
          return callback(modules[fileName].module) // Return module from Cache
        else
          return modules[fileName].callbacks.push(callback) // Not loaded yet, register callback

      modules[fileName] = {
        fileName: fileName,
        protocol: protocol,
        loaded: false,
        callbacks: [callback],
      };

      // Bootstrapping loader blueprints ;)
      //Frame('Loaders/' + protocol).from(fileName).to(fileName, opts, function(err, exportFile) {})

      const loader = 'loaders/' + protocol;
      modules[loader].module.init(); // TODO: optional init (inside Frame core)
      modules[loader].module.in(fileName, opts, function(err, exportFile){
        if (err)
          log('Error: ', err, fileName);
        else {
          log('Loaded Blueprint module: ', fileName);

          if (!exportFile || typeof exportFile !== 'object')
            throw new Error('Invalid Blueprint file, Blueprint is expected to be an object or class')

          if (typeof exportFile.name !== 'string')
            throw new Error('Invalid Blueprint file, Blueprint missing a name')

          let module = modules[fileName];
          if (!module)
            throw new Error('Uh oh, we shouldnt be here')

          // Module already loaded. Not suppose to be here. Only from force-loading would get you here.
          if (module.loaded)
            throw new Error('Blueprint "' + exportFile.name + '" already loaded.')

          module.module = exportFile;
          module.loaded = true;

          runModuleCallbacks(module);
        }
      });

      // TODO: modules[loader].module.bundle support for CLI tooling.

    } catch (err) {
      throw new Error('Could not load blueprint \'' + name + '\'\n' + err)
    }
  };

  // Frame and Blueprint constructors
  const singletons = {};
  function Frame(name, opts) {
    if (!(this instanceof Frame))
      return new Frame(name, opts)

    if (typeof name !== 'string')
      throw new Error('Blueprint name \'' + name + '\' is not valid.\n')

    // If blueprint is a singleton (for shared resources), return it instead of creating new instance.
    if (singletons[name])
      return singletons[name]

    let blueprint = new Blueprint(name);
    imports(name, opts, function(blueprintFile) {
      try {

        log('Blueprint loaded:', blueprintFile.name);

        if (typeof blueprintFile !== 'object')
          throw new Error('Blueprint is expected to be an object or class')

        // Update faux blueprint stub with real module
        assignObject(blueprint, blueprintFile);

        // Update blueprint name
        setDescriptor(blueprint, blueprintFile.name, false);
        blueprint.Frame.name = blueprintFile.name;

        // Apply a schema to blueprint
        blueprint = BlueprintSchema(blueprint);

        // TODO: If blueprint is a loader, then apply a different set of schema rules
        //if (blueprint.protocol === 'loader')
        //  blueprint = BlueprintLoaderSchema(blueprint)

        blueprint.Frame.loaded = true;
        debounce(processFlow, 1, blueprint);

        // If blueprint intends to be a singleton, add it to the list.
        if (blueprint.singleton)
          singletons[blueprint.name] = blueprint;

      } catch (err) {
        throw new Error('Blueprint \'' + name + '\' is not valid.\n' + err)
      }
    });

    return blueprint
  }

  function Blueprint(name) {
    let blueprint = new BlueprintConstructor(name);
    setDescriptor(blueprint, 'Blueprint', true);

    // Blueprint methods
    assignObject(blueprint, BlueprintMethods);

    // Create hidden blueprint.Frame property to keep state
    let blueprintBase = Object.create(BlueprintBase);
    assignObject(blueprintBase, BlueprintBase);
    Object.defineProperty(blueprint, 'Frame', { value: blueprintBase, enumerable: true, configurable: true, writable: false }); // TODO: configurable: false, enumerable: false
    blueprint.Frame.name = name;

    return blueprint
  }

  function BlueprintConstructor(name) {
    // Create blueprint from constructor
    return function() {
      let blueprint = new Frame(name);
      blueprint.Frame.props = arguments;

      return blueprint
    }
  }

  // Give Frame an easy descriptor
  setDescriptor(Frame, 'Constructor');
  setDescriptor(Frame.constructor, 'Frame');

  // Export Frame globally
  exporter('Frame', Frame);

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0pXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbmV4cG9ydCB7XG4gIGFzc2lnbk9iamVjdCxcbiAgc2V0RGVzY3JpcHRvclxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgYWRkUGlwZS5jYWxsKHRoaXMsICd0bycsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICAgIHJldHVybiB0aGlzXG4gIH0sXG5cbiAgZnJvbTogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBvdXQ6IGZ1bmN0aW9uKGVyciwgZGF0YSkge1xuICAgIGlmIChlcnIpXG4gICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvcjonLCBlcnIpXG5cbiAgICBsb2coJ291dCBkYXRhOicsIGRhdGEpXG4gICAgLy8gVE9ETzogdGhpcy5uZXh0KCkgYnV0IG5lZWRzIHRvIGJlIGF3YXJlIHRoYXQgYW4gZXZlbnQgY2FuIGhhcHBlbiBtdWx0aXBsZSB0aW1lcyBiZWZvcmUgb3RoZXIgZmxvd3MgZmluaXNoLi5cbiAgICAvLyBUT0RPOiBkZXRlcm1pbmUgd2hhdCBoYXBwZW5zIHdoZW4gYSBCbHVlcHJpbnQgc2VsZiBtb2RpZmllcy4uIGxpa2UgaW46IGZ1bmN0aW9uKCkgeyB0aGlzLnRvKCBmdW5jdGlvbigpe30gKX1cbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oZXJyKSB7XG4gICAgcmV0dXJuIGxvZy5lcnJvcignRXJyb3I6JywgZXJyKVxuICB9LFxuXG4gIC8qZ2V0IHZhbHVlKCkge1xuICAgIHRoaXMuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICB0aGlzLkZyYW1lLnByb21pc2UgPSBuZXcgUHJvbWlzZSgpXG4gICAgcmV0dXJuIHRoaXMuRnJhbWUucHJvbWlzZVxuICB9LCovXG59XG5cbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGNsYXNzLCBkaWQgeW91IGFzc2lnbiBpdCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLnRvKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGxvZyhkaXJlY3Rpb24sICcoKTogJyArIHRoaXMubmFtZSlcbiAgdGhpcy5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgdGhpcylcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50KSB7XG4gIGxldCBuYW1lID0gZnVuYy5uYW1lXG4gIGNsZWFyVGltZW91dChibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0pXG4gIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXVxuICAgIGZ1bmMuY2FsbChibHVlcHJpbnQpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKVxuICAgIHJldHVybiBpbml0Qmx1ZXByaW50LmNhbGwodGhpcywgcHJvY2Vzc0Zsb3cpXG5cbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBsb2FkZWQgYW5kIGJlZW4gaW5pdGlhbGl6ZWQuXG5cbiAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IHRydWVcbiAgbG9nKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcblxuICB0cnkge1xuICAgIGNvbnN0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24ocHJvcHMsIGNhbGxiYWNrKSB7IGNhbGxiYWNrKCkgfVxuXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbigpIHtcbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nKCdCbHVlcHJpbnQgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludClcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgcHJvcHM6IHt9LFxuICBmbG93OiBbXSxcbiAgcGlwZXM6IFtdLFxuICBkZWJvdW5jZToge30sXG4gIG5hbWU6ICcnLFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRCYXNlXG4iLCIndXNlIHN0cmljdCdcblxuLy8gQ29uY2VwdCBiYXNlZCBvbjogaHR0cDovL29iamVjdG1vZGVsLmpzLm9yZy9cbmZ1bmN0aW9uIE9iamVjdE1vZGVsKHNjaGVtYU9iaikge1xuICBpZiAodHlwZW9mIHNjaGVtYU9iaiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB7IHR5cGU6IHNjaGVtYU9iai5uYW1lLCBleHBlY3RzOiBzY2hlbWFPYmogfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFPYmogIT09ICdvYmplY3QnKVxuICAgIHNjaGVtYU9iaiA9IHt9XG5cbiAgLy8gQ2xvbmUgc2NoZW1hIG9iamVjdCBzbyB3ZSBkb24ndCBtdXRhdGUgaXQuXG4gIGxldCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAobGV0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGxldCBzY2hlbWFBcnIgPSBzY2hlbWFba2V5XVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ29wdGlvbmFsJywgdHlwZXM6IFtdIH1cbiAgICAgIGZvciAobGV0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBsZXQgcHJveHlPYmogPSB7fVxuICAgIGxldCBvYmogPSBvYmpUb1ZhbGlkYXRlXG5cbiAgICBmb3IgKGxldCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICAgIH0sXG4gIH1cblxuICBpZiAoIWNhbGxiYWNrKVxuICAgIHJldHVybiBtb2R1bGVcblxuICBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdID0gZnVuY3Rpb24oZXhwb3J0cykge1xuICAgIGNhbGxiYWNrKG51bGwsIGV4cG9ydHMpXG4gICAgZGVsZXRlIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV1cbiAgfVxuXG4gIGNvbnN0IHNjcmlwdCA9ICdtb2R1bGUucmVzb2x2ZVtcIicgKyBfX2ZpbGVuYW1lICsgJ1wiXShmdW5jdGlvbihpaWZlTW9kdWxlKXtcXG4nICtcbiAgJyAgdmFyIG1vZHVsZSA9IE1vZHVsZShpaWZlTW9kdWxlKVxcbicgK1xuICAnICB2YXIgX19maWxlbmFtZSA9IG1vZHVsZS5maWxlbmFtZVxcbicgK1xuICAnICB2YXIgX19kaXJuYW1lID0gX19maWxlbmFtZS5zbGljZSgwLCBfX2ZpbGVuYW1lLmxhc3RJbmRleE9mKFwiL1wiKSlcXG4nICtcbiAgJyAgdmFyIHJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxcbicgK1xuICAnICB2YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICcgIHZhciBwcm9jZXNzID0geyBicm93c2VyOiB0cnVlIH1cXG4nICtcbiAgJyAgdmFyIEJsdWVwcmludCA9IG51bGw7XFxuXFxuJyArXG5cbiAgJyhmdW5jdGlvbigpIHtcXG4nICsgLy8gQ3JlYXRlIElJRkUgZm9yIG1vZHVsZS9ibHVlcHJpbnRcbiAgJ1widXNlIHN0cmljdFwiO1xcbicgK1xuICAgIGZpbGVDb250ZW50cyArICdcXG4nICtcbiAgJ30pLmNhbGwobW9kdWxlLmV4cG9ydHMpO1xcbicgKyAvLyBDcmVhdGUgJ3RoaXMnIGJpbmRpbmcuXG4gICcgIGlmIChCbHVlcHJpbnQpIHsgcmV0dXJuIEJsdWVwcmludH1cXG4nICtcbiAgJyAgcmV0dXJuIG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICd9KG1vZHVsZSkpOydcblxuICB3aW5kb3cubW9kdWxlID0gbW9kdWxlXG4gIHdpbmRvdy5nbG9iYWwgPSB3aW5kb3dcbiAgd2luZG93Lk1vZHVsZSA9IE1vZHVsZVxuXG4gIHJldHVybiBzY3JpcHRcbn1cblxud2luZG93LnJlcXVpcmUgPSBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gIHdpbmRvdy5odHRwLm1vZHVsZS5pbml0LmNhbGwod2luZG93Lmh0dHAubW9kdWxlKVxuICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgbGV0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBmaWxlID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgYXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGFzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBhc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG53aW5kb3cuaHR0cCA9IGh0dHBMb2FkZXIgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICByZXF1aXJlKGZpbGUpXG4gICAgICBjYWxsYmFjaygpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnLy4uL2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcbiAgfSxcbn1cblxuXG5leHBvcnQgZGVmYXVsdCBmaWxlTG9hZGVyXG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBwcmVmZXItdGVtcGxhdGUgKi9cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgaHR0cExvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cCdcbmltcG9ydCBmaWxlTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlJ1xuXG4vLyBNdWx0aS1lbnZpcm9ubWVudCBhc3luYyBtb2R1bGUgbG9hZGVyXG5jb25zdCBtb2R1bGVzID0ge1xuICAnbG9hZGVycy9odHRwJzogaHR0cExvYWRlcixcbiAgJ2xvYWRlcnMvZmlsZSc6IGZpbGVMb2FkZXIsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5hbWUobmFtZSkge1xuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggZWFjaCBmaWxlIHBhdGggYW5kIG5vcm1hbGl6ZSBpdCB0b286XG4gIHJldHVybiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLy8uY2FwaXRhbGl6ZSgpXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVGaWxlSW5mbyhmaWxlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGaWxlTmFtZSA9IG5vcm1hbGl6ZU5hbWUoZmlsZSlcbiAgY29uc3QgcHJvdG9jb2wgPSBwYXJzZVByb3RvY29sKGZpbGUpXG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlOiBmaWxlLFxuICAgIHBhdGg6IGZpbGUsXG4gICAgbmFtZTogbm9ybWFsaXplZEZpbGVOYW1lLFxuICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVByb3RvY29sKG5hbWUpIHtcbiAgLy8gRklYTUU6IG5hbWUgc2hvdWxkIG9mIGJlZW4gbm9ybWFsaXplZCBieSBub3cuIEVpdGhlciByZW1vdmUgdGhpcyBjb2RlIG9yIG1vdmUgaXQgc29tZXdoZXJlIGVsc2UuLlxuICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsb2FkZXIgYmx1ZXByaW50IG5hbWUnKVxuXG4gIHZhciBwcm90b1Jlc3VsdHMgPSBuYW1lLm1hdGNoKC86XFwvXFwvL2dpKSAmJiBuYW1lLnNwbGl0KC86XFwvXFwvL2dpKVxuXG4gIC8vIE5vIHByb3RvY29sIGZvdW5kLCBpZiBicm93c2VyIGVudmlyb25tZW50IHRoZW4gaXMgcmVsYXRpdmUgVVJMIGVsc2UgaXMgYSBmaWxlIHBhdGguIChTYW5lIGRlZmF1bHRzIGJ1dCBjYW4gYmUgb3ZlcnJpZGRlbilcbiAgaWYgKCFwcm90b1Jlc3VsdHMpXG4gICAgcmV0dXJuICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyAnaHR0cCcgOiAnZmlsZSdcblxuICByZXR1cm4gcHJvdG9SZXN1bHRzWzBdXG59XG5cbmZ1bmN0aW9uIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpIHtcbiAgZm9yIChsZXQgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2coJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2coJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGxldCBtb2R1bGUgPSBtb2R1bGVzW2ZpbGVOYW1lXVxuICAgICAgICBpZiAoIW1vZHVsZSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VoIG9oLCB3ZSBzaG91bGRudCBiZSBoZXJlJylcblxuICAgICAgICAvLyBNb2R1bGUgYWxyZWFkeSBsb2FkZWQuIE5vdCBzdXBwb3NlIHRvIGJlIGhlcmUuIE9ubHkgZnJvbSBmb3JjZS1sb2FkaW5nIHdvdWxkIGdldCB5b3UgaGVyZS5cbiAgICAgICAgaWYgKG1vZHVsZS5sb2FkZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXCInICsgZXhwb3J0RmlsZS5uYW1lICsgJ1wiIGFscmVhZHkgbG9hZGVkLicpXG5cbiAgICAgICAgbW9kdWxlLm1vZHVsZSA9IGV4cG9ydEZpbGVcbiAgICAgICAgbW9kdWxlLmxvYWRlZCA9IHRydWVcblxuICAgICAgICBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBUT0RPOiBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmJ1bmRsZSBzdXBwb3J0IGZvciBDTEkgdG9vbGluZy5cblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBsb2FkIGJsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCdcXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGltcG9ydHNcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4vZXhwb3J0cydcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IEJsdWVwcmludE1ldGhvZHMgZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IHsgZGVib3VuY2UsIHByb2Nlc3NGbG93IH0gZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IEJsdWVwcmludEJhc2UgZnJvbSAnLi9CbHVlcHJpbnRCYXNlJ1xuaW1wb3J0IEJsdWVwcmludFNjaGVtYSBmcm9tICcuL3NjaGVtYSdcbmltcG9ydCBpbXBvcnRzIGZyb20gJy4vbG9hZGVyJ1xuXG4vLyBGcmFtZSBhbmQgQmx1ZXByaW50IGNvbnN0cnVjdG9yc1xuY29uc3Qgc2luZ2xldG9ucyA9IHt9XG5mdW5jdGlvbiBGcmFtZShuYW1lLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBGcmFtZSkpXG4gICAgcmV0dXJuIG5ldyBGcmFtZShuYW1lLCBvcHRzKVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbmFtZSBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicpXG5cbiAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICBsZXQgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludChuYW1lKVxuICBpbXBvcnRzKG5hbWUsIG9wdHMsIGZ1bmN0aW9uKGJsdWVwcmludEZpbGUpIHtcbiAgICB0cnkge1xuXG4gICAgICBsb2coJ0JsdWVwcmludCBsb2FkZWQ6JywgYmx1ZXByaW50RmlsZS5uYW1lKVxuXG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAvLyBVcGRhdGUgZmF1eCBibHVlcHJpbnQgc3R1YiB3aXRoIHJlYWwgbW9kdWxlXG4gICAgICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIGJsdWVwcmludEZpbGUpXG5cbiAgICAgIC8vIFVwZGF0ZSBibHVlcHJpbnQgbmFtZVxuICAgICAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgYmx1ZXByaW50RmlsZS5uYW1lLCBmYWxzZSlcbiAgICAgIGJsdWVwcmludC5GcmFtZS5uYW1lID0gYmx1ZXByaW50RmlsZS5uYW1lXG5cbiAgICAgIC8vIEFwcGx5IGEgc2NoZW1hIHRvIGJsdWVwcmludFxuICAgICAgYmx1ZXByaW50ID0gQmx1ZXByaW50U2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVE9ETzogSWYgYmx1ZXByaW50IGlzIGEgbG9hZGVyLCB0aGVuIGFwcGx5IGEgZGlmZmVyZW50IHNldCBvZiBzY2hlbWEgcnVsZXNcbiAgICAgIC8vaWYgKGJsdWVwcmludC5wcm90b2NvbCA9PT0gJ2xvYWRlcicpXG4gICAgICAvLyAgYmx1ZXByaW50ID0gQmx1ZXByaW50TG9hZGVyU2NoZW1hKGJsdWVwcmludClcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgbGV0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGxldCBibHVlcHJpbnQgPSBuZXcgRnJhbWUobmFtZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSBhcmd1bWVudHNcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciJdLCJtYXBwaW5ncyI6Ijs7O0VBRUEsU0FBUyxHQUFHLEdBQUc7RUFDZjtFQUNBLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QjtFQUNBLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUN0QyxFQUFDOztFQUVELEdBQUcsQ0FBQyxJQUFJLEdBQUcsV0FBVztFQUN0QjtFQUNBLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNyQyxDQUFDOztFQ2ZEO0VBQ0E7RUFDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO0VBQzdCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLEtBQUssUUFBUTtFQUN0RSxJQUFJLE1BQU0sQ0FBQyxPQUFPLEdBQUcsSUFBRzs7RUFFeEI7RUFDQSxFQUFFLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtFQUNoQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHOztFQUV0QjtFQUNBLE9BQU8sSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksTUFBTSxDQUFDLEdBQUc7RUFDckQsSUFBSSxNQUFNLENBQUMsQ0FBQyxTQUFTLENBQUMsRUFBRSxTQUFTLEdBQUcsRUFBRTtFQUN0QyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHO0VBQ3JCLEtBQUssRUFBQzs7RUFFTjtFQUNBLE9BQU8sSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRO0VBQ3JDLElBQUksTUFB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QUMsRUFBRTtFQUN2QztFQUNBLElBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxVQUFVO0VBQ3pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRTtFQUNsRSxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDNUUsTUFBTSxJQUFJLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxFQUFDO0VBQ2pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUU7RUFDcEUsTUFBTSxLQUFLLElBQUksVUFBVSxJQUFJLFNBQVMsRUFBRTtFQUN4QyxRQUFRLElBQUksT0FBTyxVQUFVLEtBQUssVUFBVTtFQUM1QyxVQUFVLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sVUFBVSxFQUFFLEVBQUM7RUFDckQsT0FBTztFQUNQLEtBQUssTUFBTSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ3BFLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sR0FBRTtFQUM1RixLQUFLLE1BQU07RUFDWCxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxJ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
