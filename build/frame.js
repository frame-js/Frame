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

        // Any schema leftover should be added back to object for future protection
        for (let key of Object.getOwnPropertyNames(schema)) {
          if (obj[key])
            continue

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
        }

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

    window.require = function(url, callback) {
      window.http.module.init.call(window.http.module);
      return window.http.module.in.call(window.http.module, url, callback)
    };


    return script
  }

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

  exporter('http', httpLoader); // TODO: Cleanup, expose modules instead

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

      in: function(fileName, opts, callback) {
        if (this.isBrowser)
          throw new Error('File:// loading within browser not supported yet. Try relative URL instead.')

        log('[file loader] Loading file: ' + fileName);

        // TODO: Switch to async file loading, improve require(), pass in IIFE to sandbox, use IIFE resolver for callback
        // TODO: Add error reporting.

        const vm = require('vm');
        const fs = require('fs');

        const filePath = this.normalizeFilePath(fileName);

        const file = this.resolveFile(filePath);
        if (!file)
          return callback('Blueprint not found')

        const fileContents = fs.readFileSync(file).toString();

        const sandbox = { Blueprint: null };
        vm.createContext(sandbox);
        vm.runInContext(fileContents, sandbox);

        callback(null, sandbox.Blueprint);
      },

      normalizeFilePath: function(fileName) {
        const path = require('path');
        return path.resolve(process.cwd(), '../blueprints/', fileName)
      },

      resolveFile: function(filePath) {
        const fs = require('fs');
        const path = require('path');

        // If file or directory exists
        if (fs.existsSync(filePath)) {
          // Check if blueprint is a directory first
          if (fs.statSync(filePath).isDirectory())
            return path.resolve(filePath, 'index.js')
          else
            return filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '')
        }

        // Try adding an extension to see if it exists
        const file = filePath + ((filePath.indexOf('.js') === -1) ? '.js' : '');
        if (fs.existsSync(file))
          return file

        return false
      }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0pXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbmV4cG9ydCB7XG4gIGFzc2lnbk9iamVjdCxcbiAgc2V0RGVzY3JpcHRvclxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgYWRkUGlwZS5jYWxsKHRoaXMsICd0bycsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICAgIHJldHVybiB0aGlzXG4gIH0sXG5cbiAgZnJvbTogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBvdXQ6IGZ1bmN0aW9uKGVyciwgZGF0YSkge1xuICAgIGlmIChlcnIpXG4gICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvcjonLCBlcnIpXG5cbiAgICBsb2coJ291dCBkYXRhOicsIGRhdGEpXG4gICAgLy8gVE9ETzogdGhpcy5uZXh0KCkgYnV0IG5lZWRzIHRvIGJlIGF3YXJlIHRoYXQgYW4gZXZlbnQgY2FuIGhhcHBlbiBtdWx0aXBsZSB0aW1lcyBiZWZvcmUgb3RoZXIgZmxvd3MgZmluaXNoLi5cbiAgICAvLyBUT0RPOiBkZXRlcm1pbmUgd2hhdCBoYXBwZW5zIHdoZW4gYSBCbHVlcHJpbnQgc2VsZiBtb2RpZmllcy4uIGxpa2UgaW46IGZ1bmN0aW9uKCkgeyB0aGlzLnRvKCBmdW5jdGlvbigpe30gKX1cbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oZXJyKSB7XG4gICAgcmV0dXJuIGxvZy5lcnJvcignRXJyb3I6JywgZXJyKVxuICB9LFxuXG4gIC8qZ2V0IHZhbHVlKCkge1xuICAgIHRoaXMuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICB0aGlzLkZyYW1lLnByb21pc2UgPSBuZXcgUHJvbWlzZSgpXG4gICAgcmV0dXJuIHRoaXMuRnJhbWUucHJvbWlzZVxuICB9LCovXG59XG5cbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGNsYXNzLCBkaWQgeW91IGFzc2lnbiBpdCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLnRvKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGxvZyhkaXJlY3Rpb24sICcoKTogJyArIHRoaXMubmFtZSlcbiAgdGhpcy5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgdGhpcylcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50KSB7XG4gIGxldCBuYW1lID0gZnVuYy5uYW1lXG4gIGNsZWFyVGltZW91dChibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0pXG4gIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXVxuICAgIGZ1bmMuY2FsbChibHVlcHJpbnQpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKVxuICAgIHJldHVybiBpbml0Qmx1ZXByaW50LmNhbGwodGhpcywgcHJvY2Vzc0Zsb3cpXG5cbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBsb2FkZWQgYW5kIGJlZW4gaW5pdGlhbGl6ZWQuXG5cbiAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IHRydWVcbiAgbG9nKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcblxuICB0cnkge1xuICAgIGNvbnN0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24ocHJvcHMsIGNhbGxiYWNrKSB7IGNhbGxiYWNrKCkgfVxuXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbigpIHtcbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nKCdCbHVlcHJpbnQgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludClcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgcHJvcHM6IHt9LFxuICBmbG93OiBbXSxcbiAgcGlwZXM6IFtdLFxuICBkZWJvdW5jZToge30sXG4gIG5hbWU6ICcnLFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRCYXNlXG4iLCIndXNlIHN0cmljdCdcblxuLy8gQ29uY2VwdCBiYXNlZCBvbjogaHR0cDovL29iamVjdG1vZGVsLmpzLm9yZy9cbmZ1bmN0aW9uIE9iamVjdE1vZGVsKHNjaGVtYU9iaikge1xuICBpZiAodHlwZW9mIHNjaGVtYU9iaiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB7IHR5cGU6IHNjaGVtYU9iai5uYW1lLCBleHBlY3RzOiBzY2hlbWFPYmogfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFPYmogIT09ICdvYmplY3QnKVxuICAgIHNjaGVtYU9iaiA9IHt9XG5cbiAgLy8gQ2xvbmUgc2NoZW1hIG9iamVjdCBzbyB3ZSBkb24ndCBtdXRhdGUgaXQuXG4gIGxldCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAobGV0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGxldCBzY2hlbWFBcnIgPSBzY2hlbWFba2V5XVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ29wdGlvbmFsJywgdHlwZXM6IFtdIH1cbiAgICAgIGZvciAobGV0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBsZXQgcHJveHlPYmogPSB7fVxuICAgIGxldCBvYmogPSBvYmpUb1ZhbGlkYXRlXG5cbiAgICBmb3IgKGxldCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGxldCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBjbG9zZTogW0Z1bmN0aW9uXSxcblxuICAvLyBJbnRlcm5hbHNcbiAgb3V0OiBGdW5jdGlvbixcbiAgZXJyb3I6IEZ1bmN0aW9uLFxufSlcblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50U2NoZW1hXG4iLCIvLyBUT0RPOiBNb2R1bGVGYWN0b3J5KCkgZm9yIGxvYWRlciwgd2hpY2ggcGFzc2VzIHRoZSBsb2FkZXIgKyBwcm90b2NvbCBpbnRvIGl0Li4gVGhhdCB3YXkgaXQncyByZWN1cnNpdmUuLi5cblxuZnVuY3Rpb24gTW9kdWxlKF9fZmlsZW5hbWUsIGZpbGVDb250ZW50cywgY2FsbGJhY2spIHtcbiAgLy8gRnJvbSBpaWZlIGNvZGVcbiAgaWYgKCFmaWxlQ29udGVudHMpXG4gICAgX19maWxlbmFtZSA9IF9fZmlsZW5hbWUucGF0aCB8fCAnJ1xuXG4gIHZhciBtb2R1bGUgPSB7XG4gICAgZmlsZW5hbWU6IF9fZmlsZW5hbWUsXG4gICAgZXhwb3J0czoge30sXG4gICAgQmx1ZXByaW50OiBudWxsLFxuICAgIHJlc29sdmU6IHt9LFxuXG4gICAgcmVxdWlyZTogZnVuY3Rpb24odXJsLCBjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICB3aW5kb3cuaHR0cC5tb2R1bGUuaW5pdC5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSlcbiAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICB9XG5cblxuICByZXR1cm4gc2NyaXB0XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vZHVsZVxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuaW1wb3J0IE1vZHVsZSBmcm9tICcuLi8uLi9saWIvTW9kdWxlTG9hZGVyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4uLy4uL2xpYi9leHBvcnRzJ1xuXG4vLyBFbWJlZGRlZCBodHRwIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBodHRwTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9odHRwJyxcbiAgcHJvdG9jb2w6ICdsb2FkZXInLCAvLyBlbWJlZGRlZCBsb2FkZXJcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnSFRUUCBMb2FkZXInLFxuICAgIHByb3RvY29sOiBbJ2h0dHAnLCAnaHR0cHMnLCAnd2ViOi8vJ10sIC8vIFRPRE86IENyZWF0ZSBhIHdheSBmb3IgbG9hZGVyIHRvIHN1YnNjcmliZSB0byBtdWx0aXBsZSBwcm90b2NvbHNcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICghdGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnVVJMIGxvYWRpbmcgd2l0aCBub2RlLmpzIG5vdCBzdXBwb3J0ZWQgeWV0IChDb21pbmcgc29vbiEpLicpXG5cbiAgICAgIHJldHVybiB0aGlzLmJyb3dzZXIubG9hZC5jYWxsKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBsZXQgZmlsZSA9IGZpbGVOYW1lICsgKChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGZpbGUgPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVcbiAgICB9LFxuXG4gICAgYnJvd3Nlcjoge1xuICAgICAgbG9hZDogZnVuY3Rpb24oZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcbiAgICAgICAgbG9nKCdbaHR0cCBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVQYXRoKVxuXG4gICAgICAgIHZhciBhc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgYXN5bmMgPSBmYWxzZVxuICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCBmaWxlKSB7XG4gICAgICAgICAgICBpZiAoZXJyKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyKVxuXG4gICAgICAgICAgICByZXR1cm4gc3luY0ZpbGUgPSBmaWxlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgICAgLy8gVE9ETzogTmVlZHMgdmFsaWRhdGluZyB0aGF0IGV2ZW50IGhhbmRsZXJzIHdvcmsgYWNyb3NzIGJyb3dzZXJzLiBNb3JlIHNwZWNpZmljYWxseSwgdGhhdCB0aGV5IHJ1biBvbiBFUzUgZW52aXJvbm1lbnRzLlxuICAgICAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvWE1MSHR0cFJlcXVlc3QjQnJvd3Nlcl9jb21wYXRpYmlsaXR5XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IG5ldyB0aGlzLmJyb3dzZXIuc2NyaXB0RXZlbnRzKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuXG4gICAgICAgIHNjcmlwdFJlcXVlc3Qub3BlbignR0VUJywgZmlsZVBhdGgsIGFzeW5jKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LnNlbmQobnVsbClcblxuICAgICAgICByZXR1cm4gc3luY0ZpbGVcbiAgICAgIH0sXG5cbiAgICAgIHNjcmlwdEV2ZW50czogZnVuY3Rpb24obG9hZGVyLCBmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gICAgICAgIHRoaXMuZmlsZU5hbWUgPSBmaWxlTmFtZVxuICAgICAgICB0aGlzLm9uTG9hZCA9IGxvYWRlci5icm93c2VyLm9uTG9hZC5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgICAgdGhpcy5vbkVycm9yID0gbG9hZGVyLmJyb3dzZXIub25FcnJvci5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgIH0sXG5cbiAgICAgIG9uTG9hZDogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSB0aGlzXG5cbiAgICAgICAgICBpZiAoc2NyaXB0UmVxdWVzdC5zdGF0dXMgPiA0MDApXG4gICAgICAgICAgICByZXR1cm4gc2NyaXB0RXZlbnRzLm9uRXJyb3IuY2FsbChzY3JpcHRSZXF1ZXN0LCBzY3JpcHRSZXF1ZXN0LnN0YXR1c1RleHQpXG5cbiAgICAgICAgICBjb25zdCBzY3JpcHRDb250ZW50ID0gTW9kdWxlKHNjcmlwdFJlcXVlc3QucmVzcG9uc2VVUkwsIHNjcmlwdFJlcXVlc3QucmVzcG9uc2VUZXh0LCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG5cbiAgICAgICAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudFxuICAgICAgICAgIHZhciBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKVxuICAgICAgICAgIHNjcmlwdFRhZy50ZXh0Q29udGVudCA9IHNjcmlwdENvbnRlbnRcblxuICAgICAgICAgIGh0bWwuYXBwZW5kQ2hpbGQoc2NyaXB0VGFnKVxuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIG9uRXJyb3I6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gc2NyaXB0RXZlbnRzLmZpbGVOYW1lXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFRhZyA9IHRoaXNcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuXG4gICAgICAgICAgLy8gVHJ5IHRvIGZhbGxiYWNrIHRvIGluZGV4LmpzXG4gICAgICAgICAgLy8gRklYTUU6IGluc3RlYWQgb2YgZmFsbGluZyBiYWNrLCB0aGlzIHNob3VsZCBiZSB0aGUgZGVmYXVsdCBpZiBubyBgLmpzYCBpcyBkZXRlY3RlZCwgYnV0IFVSTCB1Z2xpZmllcnMgYW5kIHN1Y2ggd2lsbCBoYXZlIGlzc3Vlcy4uIGhybW1tbS4uXG4gICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSAmJiBmaWxlTmFtZS5pbmRleE9mKCdpbmRleC5qcycpID09PSAtMSkge1xuICAgICAgICAgICAgbG9nLndhcm4oJ1todHRwXSBBdHRlbXB0aW5nIHRvIGZhbGxiYWNrIHRvOiAnLCBmaWxlTmFtZSArICcvaW5kZXguanMnKVxuICAgICAgICAgICAgcmV0dXJuIGxvYWRlci5pbi5jYWxsKGxvYWRlciwgZmlsZU5hbWUgKyAnL2luZGV4LmpzJywgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHNjcmlwdEV2ZW50cy5jYWxsYmFjaygnQ291bGQgbm90IGxvYWQgQmx1ZXByaW50JylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgY2xlYW51cDogZnVuY3Rpb24oc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpIHtcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcbiAgICAgICAgLy9kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdLnJlbW92ZUNoaWxkKHNjcmlwdFRhZykgLy8gVE9ETzogQ2xlYW51cFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgbm9kZToge1xuICAgICAgLy8gU3R1YiBmb3Igbm9kZS5qcyBIVFRQIGxvYWRpbmcgc3VwcG9ydC5cbiAgICB9LFxuXG4gIH0sXG59XG5cbmV4cG9ydGVyKCdodHRwJywgaHR0cExvYWRlcikgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuXG4gICAgICAvLyBUT0RPOiBTd2l0Y2ggdG8gYXN5bmMgZmlsZSBsb2FkaW5nLCBpbXByb3ZlIHJlcXVpcmUoKSwgcGFzcyBpbiBJSUZFIHRvIHNhbmRib3gsIHVzZSBJSUZFIHJlc29sdmVyIGZvciBjYWxsYmFja1xuICAgICAgLy8gVE9ETzogQWRkIGVycm9yIHJlcG9ydGluZy5cblxuICAgICAgY29uc3Qgdm0gPSByZXF1aXJlKCd2bScpXG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlRmlsZShmaWxlUGF0aClcbiAgICAgIGlmICghZmlsZSlcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdCbHVlcHJpbnQgbm90IGZvdW5kJylcblxuICAgICAgY29uc3QgZmlsZUNvbnRlbnRzID0gZnMucmVhZEZpbGVTeW5jKGZpbGUpLnRvU3RyaW5nKClcblxuICAgICAgY29uc3Qgc2FuZGJveCA9IHsgQmx1ZXByaW50OiBudWxsIH1cbiAgICAgIHZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIHZtLnJ1bkluQ29udGV4dChmaWxlQ29udGVudHMsIHNhbmRib3gpXG5cbiAgICAgIGNhbGxiYWNrKG51bGwsIHNhbmRib3guQmx1ZXByaW50KVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcbiAgICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJy4uL2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcblxuICAgIHJlc29sdmVGaWxlOiBmdW5jdGlvbihmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG5cbiAgICAgIC8vIElmIGZpbGUgb3IgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIGJsdWVwcmludCBpcyBhIGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMoZmlsZVBhdGgpLmlzRGlyZWN0b3J5KCkpXG4gICAgICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShmaWxlUGF0aCwgJ2luZGV4LmpzJylcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHJldHVybiBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICB9XG5cbiAgICAgIC8vIFRyeSBhZGRpbmcgYW4gZXh0ZW5zaW9uIHRvIHNlZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSlcbiAgICAgICAgcmV0dXJuIGZpbGVcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9LFxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGZpbGVMb2FkZXJcbiIsIi8qIGVzbGludC1kaXNhYmxlIHByZWZlci10ZW1wbGF0ZSAqL1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBodHRwTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwJ1xuaW1wb3J0IGZpbGVMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUnXG5cbi8vIE11bHRpLWVudmlyb25tZW50IGFzeW5jIG1vZHVsZSBsb2FkZXJcbmNvbnN0IG1vZHVsZXMgPSB7XG4gICdsb2FkZXJzL2h0dHAnOiBodHRwTG9hZGVyLFxuICAnbG9hZGVycy9maWxlJzogZmlsZUxvYWRlcixcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gIC8vIFRPRE86IGxvb3AgdGhyb3VnaCBlYWNoIGZpbGUgcGF0aCBhbmQgbm9ybWFsaXplIGl0IHRvbzpcbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkvLy5jYXBpdGFsaXplKClcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUZpbGVJbmZvKGZpbGUpIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVOYW1lID0gbm9ybWFsaXplTmFtZShmaWxlKVxuICBjb25zdCBwcm90b2NvbCA9IHBhcnNlUHJvdG9jb2woZmlsZSlcblxuICByZXR1cm4ge1xuICAgIGZpbGU6IGZpbGUsXG4gICAgcGF0aDogZmlsZSxcbiAgICBuYW1lOiBub3JtYWxpemVkRmlsZU5hbWUsXG4gICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvdG9jb2wobmFtZSkge1xuICAvLyBGSVhNRTogbmFtZSBzaG91bGQgb2YgYmVlbiBub3JtYWxpemVkIGJ5IG5vdy4gRWl0aGVyIHJlbW92ZSB0aGlzIGNvZGUgb3IgbW92ZSBpdCBzb21ld2hlcmUgZWxzZS4uXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxvYWRlciBibHVlcHJpbnQgbmFtZScpXG5cbiAgdmFyIHByb3RvUmVzdWx0cyA9IG5hbWUubWF0Y2goLzpcXC9cXC8vZ2kpICYmIG5hbWUuc3BsaXQoLzpcXC9cXC8vZ2kpXG5cbiAgLy8gTm8gcHJvdG9jb2wgZm91bmQsIGlmIGJyb3dzZXIgZW52aXJvbm1lbnQgdGhlbiBpcyByZWxhdGl2ZSBVUkwgZWxzZSBpcyBhIGZpbGUgcGF0aC4gKFNhbmUgZGVmYXVsdHMgYnV0IGNhbiBiZSBvdmVycmlkZGVuKVxuICBpZiAoIXByb3RvUmVzdWx0cylcbiAgICByZXR1cm4gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/ICdodHRwJyA6ICdmaWxlJ1xuXG4gIHJldHVybiBwcm90b1Jlc3VsdHNbMF1cbn1cblxuZnVuY3Rpb24gcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSkge1xuICBmb3IgKGxldCBjYWxsYmFjayBvZiBtb2R1bGUuY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2sobW9kdWxlLm1vZHVsZSlcbiAgfVxuXG4gIG1vZHVsZS5jYWxsYmFja3MgPSBbXVxufVxuXG5jb25zdCBpbXBvcnRzID0gZnVuY3Rpb24obmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlSW5mbyA9IHJlc29sdmVGaWxlSW5mbyhuYW1lKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gZmlsZUluZm8ubmFtZVxuICAgIGNvbnN0IHByb3RvY29sID0gZmlsZUluZm8ucHJvdG9jb2xcblxuICAgIGxvZygnbG9hZGluZyBtb2R1bGU6JywgZmlsZU5hbWUpXG5cbiAgICAvLyBNb2R1bGUgaGFzIGxvYWRlZCBvciBzdGFydGVkIHRvIGxvYWRcbiAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0pXG4gICAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0ubG9hZGVkKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2sobW9kdWxlc1tmaWxlTmFtZV0ubW9kdWxlKSAvLyBSZXR1cm4gbW9kdWxlIGZyb20gQ2FjaGVcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG1vZHVsZXNbZmlsZU5hbWVdLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAvLyBOb3QgbG9hZGVkIHlldCwgcmVnaXN0ZXIgY2FsbGJhY2tcblxuICAgIG1vZHVsZXNbZmlsZU5hbWVdID0ge1xuICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxuICAgICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICAgICAgbG9hZGVkOiBmYWxzZSxcbiAgICAgIGNhbGxiYWNrczogW2NhbGxiYWNrXSxcbiAgICB9XG5cbiAgICAvLyBCb290c3RyYXBwaW5nIGxvYWRlciBibHVlcHJpbnRzIDspXG4gICAgLy9GcmFtZSgnTG9hZGVycy8nICsgcHJvdG9jb2wpLmZyb20oZmlsZU5hbWUpLnRvKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpIHt9KVxuXG4gICAgY29uc3QgbG9hZGVyID0gJ2xvYWRlcnMvJyArIHByb3RvY29sXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbml0KCkgLy8gVE9ETzogb3B0aW9uYWwgaW5pdCAoaW5zaWRlIEZyYW1lIGNvcmUpXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbihmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKXtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIGxvZygnRXJyb3I6ICcsIGVyciwgZmlsZU5hbWUpXG4gICAgICBlbHNlIHtcbiAgICAgICAgbG9nKCdMb2FkZWQgQmx1ZXByaW50IG1vZHVsZTogJywgZmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKCFleHBvcnRGaWxlIHx8IHR5cGVvZiBleHBvcnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0RmlsZS5uYW1lICE9PSAnc3RyaW5nJylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBtaXNzaW5nIGEgbmFtZScpXG5cbiAgICAgICAgbGV0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBUT0RPOiBJZiBibHVlcHJpbnQgaXMgYSBsb2FkZXIsIHRoZW4gYXBwbHkgYSBkaWZmZXJlbnQgc2V0IG9mIHNjaGVtYSBydWxlc1xuICAgICAgLy9pZiAoYmx1ZXByaW50LnByb3RvY29sID09PSAnbG9hZGVyJylcbiAgICAgIC8vICBibHVlcHJpbnQgPSBCbHVlcHJpbnRMb2FkZXJTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBsZXQgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgbGV0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgcmV0dXJuIGJsdWVwcmludFxuICB9XG59XG5cbi8vIEdpdmUgRnJhbWUgYW4gZWFzeSBkZXNjcmlwdG9yXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUsICdDb25zdHJ1Y3RvcicpXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUuY29uc3RydWN0b3IsICdGcmFtZScpXG5cbi8vIEV4cG9ydCBGcmFtZSBnbG9iYWxseVxuZXhwb3J0ZXIoJ0ZyYW1lJywgRnJhbWUpXG5leHBvcnQgZGVmYXVsdCBGcmFtZVxuIl0sIm5hbWVzIjpbImhlbHBlcnMuYXNzaWduT2JqZWN0IiwiaGVscGVycy5zZXREZXNjcmlwdG9yIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BD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
