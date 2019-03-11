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

  // Sanitize user input for parameter destructuring into 'props' object.
  function createSanitizers(source, keys) {
    let target = {};

    // If no sanitizers exist, stub them so we don't run into issues with sanitize() later.
    if (!source)
      source = {};

    // Array of keys to sanitize. Example: ['init', 'in', etc]
    for (let key of keys) {
      target[key] = [];

      if (typeof source[key] !== 'object')
        continue

      // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
      let propIndex = [];
      for (let prop of Object.keys(source[key])) {
        propIndex.push({ name: prop, description: source[key][prop] });
      }

      target[key] = propIndex;
    }

    return target
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
    describe: ['init', 'in', 'out'],
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
    describe: [Object],

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

        // Validate Blueprint input with optional sanitizers (using describe syntax)
        blueprint.describe = createSanitizers(blueprint.describe, BlueprintBase.describe);

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0pXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIFNhbml0aXplIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVTYW5pdGl6ZXJzKHNvdXJjZSwga2V5cykge1xuICBsZXQgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyBzYW5pdGl6ZXJzIGV4aXN0LCBzdHViIHRoZW0gc28gd2UgZG9uJ3QgcnVuIGludG8gaXNzdWVzIHdpdGggc2FuaXRpemUoKSBsYXRlci5cbiAgaWYgKCFzb3VyY2UpXG4gICAgc291cmNlID0ge31cblxuICAvLyBBcnJheSBvZiBrZXlzIHRvIHNhbml0aXplLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGxldCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAobGV0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIHNhbml0aXplKHRhcmdldCwgcHJvcHMpIHtcbiAgcHJvcHMgPSBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCB0YXJnZXQsIENhbm5vdCBzYW5pdGl6ZSB3aXRob3V0IGZpcnN0IGhhdmluZyBhIGNvbnRleHQnKVxuXG4gIGxldCBzYW5pdGl6ZWRQcm9wcyA9IHt9XG4gIGxldCBwcm9wSW5kZXggPSAwXG5cbiAgLy8gTG9vcCB0aHJvdWdoIG91ciB0YXJnZXQgc2FuaXRpemVyIGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGxldCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHNhbml0aXplZFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBwcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCBzYW5pdGl6ZXI7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiBzYW5pdGl6ZWRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZVNhbml0aXplcnMsXG4gIHNhbml0aXplXG59XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgICByZXR1cm4gdGhpc1xuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oZXJyLCBkYXRhKSB7XG4gICAgaWYgKGVycilcbiAgICAgIHJldHVybiBsb2cuZXJyb3IoJ0Vycm9yOicsIGVycilcblxuICAgIGxvZygnb3V0IGRhdGE6JywgZGF0YSlcbiAgICAvLyBUT0RPOiB0aGlzLm5leHQoKSBidXQgbmVlZHMgdG8gYmUgYXdhcmUgdGhhdCBhbiBldmVudCBjYW4gaGFwcGVuIG11bHRpcGxlIHRpbWVzIGJlZm9yZSBvdGhlciBmbG93cyBmaW5pc2guLlxuICAgIC8vIFRPRE86IGRldGVybWluZSB3aGF0IGhhcHBlbnMgd2hlbiBhIEJsdWVwcmludCBzZWxmIG1vZGlmaWVzLi4gbGlrZSBpbjogZnVuY3Rpb24oKSB7IHRoaXMudG8oIGZ1bmN0aW9uKCl7fSApfVxuICB9LFxuXG4gIGVycm9yOiBmdW5jdGlvbihlcnIpIHtcbiAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvcjonLCBlcnIpXG4gIH0sXG5cbiAgLypnZXQgdmFsdWUoKSB7XG4gICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gdHJ1ZVxuICAgIHRoaXMuRnJhbWUucHJvbWlzZSA9IG5ldyBQcm9taXNlKClcbiAgICByZXR1cm4gdGhpcy5GcmFtZS5wcm9taXNlXG4gIH0sKi9cbn1cblxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgY2xhc3MsIGRpZCB5b3UgYXNzaWduIGl0IHRvIGEgdmFyaWFibGU/JylcblxuICBpZiAoIXRoaXMuRnJhbWUgfHwgIXRoaXMuRnJhbWUucGlwZXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3Qgd29ya2luZyB3aXRoIGEgdmFsaWQgQmx1ZXByaW50IG9iamVjdCcpXG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgIT09ICdmdW5jdGlvbicpXG4gICAgdGhyb3cgbmV3IEVycm9yKHRoaXMuRnJhbWUubmFtZSArICcudG8oKSB3YXMgY2FsbGVkIHdpdGggaW1wcm9wZXIgcGFyYW1ldGVycycpXG5cbiAgbG9nKGRpcmVjdGlvbiwgJygpOiAnICsgdGhpcy5uYW1lKVxuICB0aGlzLkZyYW1lLnBpcGVzLnB1c2goeyBkaXJlY3Rpb246IGRpcmVjdGlvbiwgdGFyZ2V0OiB0YXJnZXQsIHBhcmFtczogcGFyYW1zIH0pXG4gIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCB0aGlzKVxufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBibHVlcHJpbnQpIHtcbiAgbGV0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5jYWxsKGJsdWVwcmludClcbiAgfSwgd2FpdClcbn1cblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gaWYgYmx1ZXByaW50IGhhcyBub3QgYmVlbiBpbml0aWFsaXplZCB5ZXQgKGkuZS4gY29uc3RydWN0b3Igbm90IHVzZWQuKVxuICBpZiAoIXRoaXMuRnJhbWUuaW5pdGlhbGl6ZWQpXG4gICAgcmV0dXJuIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcblxuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggYWxsIGJsdWVwcmludHMgaW4gZmxvdyB0byBtYWtlIHN1cmUgdGhleSBoYXZlIGxvYWRlZCBhbmQgYmVlbiBpbml0aWFsaXplZC5cblxuICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gdHJ1ZVxuICBsb2coJ1Byb2Nlc3NpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcbn1cblxuZnVuY3Rpb24gaW5pdEJsdWVwcmludChjYWxsYmFjaykge1xuICBsZXQgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcHJvcHMgPSBibHVlcHJpbnQuRnJhbWUucHJvcHMgPyBibHVlcHJpbnQuRnJhbWUucHJvcHMgOiB7fVxuXG4gICAgLy8gSWYgQmx1ZXByaW50IGZvcmVnb2VzIHRoZSBpbml0aWFsaXplciwgc3R1YiBpdC5cbiAgICBpZiAoIWJsdWVwcmludC5pbml0KVxuICAgICAgYmx1ZXByaW50LmluaXQgPSBmdW5jdGlvbihwcm9wcywgY2FsbGJhY2spIHsgY2FsbGJhY2soKSB9XG5cbiAgICBibHVlcHJpbnQuaW5pdC5jYWxsKGJsdWVwcmludCwgcHJvcHMsIGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQmx1ZXByaW50IGludGl0aWFsemVkXG4gICAgICBsb2coJ0JsdWVwcmludCBpbnRpYWxpemVkJylcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0ge31cbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXplZCA9IHRydWVcbiAgICAgIGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuLy8gSW50ZXJuYWwgRnJhbWUgcHJvcHNcbmNvbnN0IEJsdWVwcmludEJhc2UgPSB7XG4gIGxvYWRlZDogZmFsc2UsXG4gIGluaXRpYWxpemVkOiBmYWxzZSxcbiAgcHJvY2Vzc2luZ0Zsb3c6IGZhbHNlLFxuICBwcm9wczoge30sXG4gIGZsb3c6IFtdLFxuICBwaXBlczogW10sXG4gIGRlYm91bmNlOiB7fSxcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgbGV0IHNjaGVtYSA9IE9iamVjdC5jcmVhdGUoc2NoZW1hT2JqKVxuICBPYmplY3QuYXNzaWduKHNjaGVtYSwgc2NoZW1hT2JqKVxuXG4gIC8vIExvb3AgdGhyb3VnaCBTY2hlbWEgb2JqZWN0IGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgbGV0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChsZXQgc2NoZW1hVHlwZSBvZiBzY2hlbWFBcnIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzY2hlbWFUeXBlID09PSAnZnVuY3Rpb24nKVxuICAgICAgICAgIHNjaGVtYVtrZXldLnR5cGVzLnB1c2godHlwZW9mIHNjaGVtYVR5cGUoKSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiBzY2hlbWFba2V5XS50eXBlLCBleHBlY3RzOiBzY2hlbWFba2V5XS5leHBlY3RzIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0gfVxuICAgIH1cbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSBwcm9wc1xuICBmdW5jdGlvbiBpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpIHtcbiAgICAvLyBUT0RPOiBNYWtlIG1vcmUgZmxleGlibGUgYnkgZGVmaW5pbmcgbnVsbCBhbmQgdW5kZWZpbmVkIHR5cGVzLlxuICAgIC8vIE5vIHNjaGVtYSBkZWZpbmVkIGZvciBrZXlcbiAgICBpZiAoIXNjaGVtYVtrZXldKVxuICAgICAgcmV0dXJuIHRydWVcblxuICAgIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiB0eXBlb2YgdmFsdWUgPT09IHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmICghc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgaWYgKHZhbHVlICYmICFzY2hlbWFba2V5XS50eXBlcy5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKVxuICAgICAgICByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0uZXhwZWN0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gc2NoZW1hW2tleV0uZXhwZWN0cyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSAob25jZSBTY2hlbWEgY29uc3RydWN0b3IgaXMgY2FsbGVkKVxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGVTY2hlbWEob2JqVG9WYWxpZGF0ZSkge1xuICAgIGxldCBwcm94eU9iaiA9IHt9XG4gICAgbGV0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmpUb1ZhbGlkYXRlKSkge1xuICAgICAgY29uc3QgcHJvcERlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9ialRvVmFsaWRhdGUsIGtleSlcblxuICAgICAgLy8gUHJvcGVydHkgYWxyZWFkeSBwcm90ZWN0ZWRcbiAgICAgIGlmICghcHJvcERlc2NyaXB0b3Iud3JpdGFibGUgfHwgIXByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyBTY2hlbWEgZG9lcyBub3QgZXhpc3QgZm9yIHByb3AsIHBhc3N0aHJvdWdoXG4gICAgICBpZiAoIXNjaGVtYVtrZXldKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICB9LFxuXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBBbnkgc2NoZW1hIGxlZnRvdmVyIHNob3VsZCBiZSBhZGRlZCBiYWNrIHRvIG9iamVjdCBmb3IgZnV0dXJlIHByb3RlY3Rpb25cbiAgICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludFNjaGVtYVxuIiwiLy8gVE9ETzogTW9kdWxlRmFjdG9yeSgpIGZvciBsb2FkZXIsIHdoaWNoIHBhc3NlcyB0aGUgbG9hZGVyICsgcHJvdG9jb2wgaW50byBpdC4uIFRoYXQgd2F5IGl0J3MgcmVjdXJzaXZlLi4uXG5cbmZ1bmN0aW9uIE1vZHVsZShfX2ZpbGVuYW1lLCBmaWxlQ29udGVudHMsIGNhbGxiYWNrKSB7XG4gIC8vIEZyb20gaWlmZSBjb2RlXG4gIGlmICghZmlsZUNvbnRlbnRzKVxuICAgIF9fZmlsZW5hbWUgPSBfX2ZpbGVuYW1lLnBhdGggfHwgJydcblxuICB2YXIgbW9kdWxlID0ge1xuICAgIGZpbGVuYW1lOiBfX2ZpbGVuYW1lLFxuICAgIGV4cG9ydHM6IHt9LFxuICAgIEJsdWVwcmludDogbnVsbCxcbiAgICByZXNvbHZlOiB7fSxcblxuICAgIHJlcXVpcmU6IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gICAgfSxcbiAgfVxuXG4gIGlmICghY2FsbGJhY2spXG4gICAgcmV0dXJuIG1vZHVsZVxuXG4gIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV0gPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgZXhwb3J0cylcbiAgICBkZWxldGUgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXVxuICB9XG5cbiAgY29uc3Qgc2NyaXB0ID0gJ21vZHVsZS5yZXNvbHZlW1wiJyArIF9fZmlsZW5hbWUgKyAnXCJdKGZ1bmN0aW9uKGlpZmVNb2R1bGUpe1xcbicgK1xuICAnICB2YXIgbW9kdWxlID0gTW9kdWxlKGlpZmVNb2R1bGUpXFxuJyArXG4gICcgIHZhciBfX2ZpbGVuYW1lID0gbW9kdWxlLmZpbGVuYW1lXFxuJyArXG4gICcgIHZhciBfX2Rpcm5hbWUgPSBfX2ZpbGVuYW1lLnNsaWNlKDAsIF9fZmlsZW5hbWUubGFzdEluZGV4T2YoXCIvXCIpKVxcbicgK1xuICAnICB2YXIgcmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXFxuJyArXG4gICcgIHZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJyAgdmFyIHByb2Nlc3MgPSB7IGJyb3dzZXI6IHRydWUgfVxcbicgK1xuICAnICB2YXIgQmx1ZXByaW50ID0gbnVsbDtcXG5cXG4nICtcblxuICAnKGZ1bmN0aW9uKCkge1xcbicgKyAvLyBDcmVhdGUgSUlGRSBmb3IgbW9kdWxlL2JsdWVwcmludFxuICAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArXG4gICAgZmlsZUNvbnRlbnRzICsgJ1xcbicgK1xuICAnfSkuY2FsbChtb2R1bGUuZXhwb3J0cyk7XFxuJyArIC8vIENyZWF0ZSAndGhpcycgYmluZGluZy5cbiAgJyAgaWYgKEJsdWVwcmludCkgeyByZXR1cm4gQmx1ZXByaW50fVxcbicgK1xuICAnICByZXR1cm4gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJ30obW9kdWxlKSk7J1xuXG4gIHdpbmRvdy5tb2R1bGUgPSBtb2R1bGVcbiAgd2luZG93Lmdsb2JhbCA9IHdpbmRvd1xuICB3aW5kb3cuTW9kdWxlID0gTW9kdWxlXG5cbiAgd2luZG93LnJlcXVpcmUgPSBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgd2luZG93Lmh0dHAubW9kdWxlLmluaXQuY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUpXG4gICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgfVxuXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgbGV0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBmaWxlID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgYXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGFzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBhc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIGNvbnN0IHNhbmRib3ggPSB7IEJsdWVwcmludDogbnVsbCB9XG4gICAgICB2bS5jcmVhdGVDb250ZXh0KHNhbmRib3gpXG4gICAgICB2bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuXG4gICAgICBjYWxsYmFjayhudWxsLCBzYW5kYm94LkJsdWVwcmludClcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICcuLi9ibHVlcHJpbnRzLycsIGZpbGVOYW1lKVxuICAgIH0sXG5cbiAgICByZXNvbHZlRmlsZTogZnVuY3Rpb24oZmlsZVBhdGgpIHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuXG4gICAgICAvLyBJZiBmaWxlIG9yIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAvLyBDaGVjayBpZiBibHVlcHJpbnQgaXMgYSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgaWYgKGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAgIHJldHVybiBwYXRoLnJlc29sdmUoZmlsZVBhdGgsICdpbmRleC5qcycpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgfVxuXG4gICAgICAvLyBUcnkgYWRkaW5nIGFuIGV4dGVuc2lvbiB0byBzZWUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCBmaWxlID0gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZSkpXG4gICAgICAgIHJldHVybiBmaWxlXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfSxcbn1cblxuXG5leHBvcnQgZGVmYXVsdCBmaWxlTG9hZGVyXG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBwcmVmZXItdGVtcGxhdGUgKi9cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgaHR0cExvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cCdcbmltcG9ydCBmaWxlTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlJ1xuXG4vLyBNdWx0aS1lbnZpcm9ubWVudCBhc3luYyBtb2R1bGUgbG9hZGVyXG5jb25zdCBtb2R1bGVzID0ge1xuICAnbG9hZGVycy9odHRwJzogaHR0cExvYWRlcixcbiAgJ2xvYWRlcnMvZmlsZSc6IGZpbGVMb2FkZXIsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5hbWUobmFtZSkge1xuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggZWFjaCBmaWxlIHBhdGggYW5kIG5vcm1hbGl6ZSBpdCB0b286XG4gIHJldHVybiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLy8uY2FwaXRhbGl6ZSgpXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVGaWxlSW5mbyhmaWxlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGaWxlTmFtZSA9IG5vcm1hbGl6ZU5hbWUoZmlsZSlcbiAgY29uc3QgcHJvdG9jb2wgPSBwYXJzZVByb3RvY29sKGZpbGUpXG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlOiBmaWxlLFxuICAgIHBhdGg6IGZpbGUsXG4gICAgbmFtZTogbm9ybWFsaXplZEZpbGVOYW1lLFxuICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVByb3RvY29sKG5hbWUpIHtcbiAgLy8gRklYTUU6IG5hbWUgc2hvdWxkIG9mIGJlZW4gbm9ybWFsaXplZCBieSBub3cuIEVpdGhlciByZW1vdmUgdGhpcyBjb2RlIG9yIG1vdmUgaXQgc29tZXdoZXJlIGVsc2UuLlxuICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsb2FkZXIgYmx1ZXByaW50IG5hbWUnKVxuXG4gIHZhciBwcm90b1Jlc3VsdHMgPSBuYW1lLm1hdGNoKC86XFwvXFwvL2dpKSAmJiBuYW1lLnNwbGl0KC86XFwvXFwvL2dpKVxuXG4gIC8vIE5vIHByb3RvY29sIGZvdW5kLCBpZiBicm93c2VyIGVudmlyb25tZW50IHRoZW4gaXMgcmVsYXRpdmUgVVJMIGVsc2UgaXMgYSBmaWxlIHBhdGguIChTYW5lIGRlZmF1bHRzIGJ1dCBjYW4gYmUgb3ZlcnJpZGRlbilcbiAgaWYgKCFwcm90b1Jlc3VsdHMpXG4gICAgcmV0dXJuICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyAnaHR0cCcgOiAnZmlsZSdcblxuICByZXR1cm4gcHJvdG9SZXN1bHRzWzBdXG59XG5cbmZ1bmN0aW9uIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpIHtcbiAgZm9yIChsZXQgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2coJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2coJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGxldCBtb2R1bGUgPSBtb2R1bGVzW2ZpbGVOYW1lXVxuICAgICAgICBpZiAoIW1vZHVsZSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VoIG9oLCB3ZSBzaG91bGRudCBiZSBoZXJlJylcblxuICAgICAgICAvLyBNb2R1bGUgYWxyZWFkeSBsb2FkZWQuIE5vdCBzdXBwb3NlIHRvIGJlIGhlcmUuIE9ubHkgZnJvbSBmb3JjZS1sb2FkaW5nIHdvdWxkIGdldCB5b3UgaGVyZS5cbiAgICAgICAgaWYgKG1vZHVsZS5sb2FkZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXCInICsgZXhwb3J0RmlsZS5uYW1lICsgJ1wiIGFscmVhZHkgbG9hZGVkLicpXG5cbiAgICAgICAgbW9kdWxlLm1vZHVsZSA9IGV4cG9ydEZpbGVcbiAgICAgICAgbW9kdWxlLmxvYWRlZCA9IHRydWVcblxuICAgICAgICBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBUT0RPOiBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmJ1bmRsZSBzdXBwb3J0IGZvciBDTEkgdG9vbGluZy5cblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBsb2FkIGJsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCdcXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGltcG9ydHNcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4vZXhwb3J0cydcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IEJsdWVwcmludE1ldGhvZHMgZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IHsgZGVib3VuY2UsIHByb2Nlc3NGbG93IH0gZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IEJsdWVwcmludEJhc2UgZnJvbSAnLi9CbHVlcHJpbnRCYXNlJ1xuaW1wb3J0IEJsdWVwcmludFNjaGVtYSBmcm9tICcuL3NjaGVtYSdcbmltcG9ydCBpbXBvcnRzIGZyb20gJy4vbG9hZGVyJ1xuXG4vLyBGcmFtZSBhbmQgQmx1ZXByaW50IGNvbnN0cnVjdG9yc1xuY29uc3Qgc2luZ2xldG9ucyA9IHt9XG5mdW5jdGlvbiBGcmFtZShuYW1lLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBGcmFtZSkpXG4gICAgcmV0dXJuIG5ldyBGcmFtZShuYW1lLCBvcHRzKVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbmFtZSBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicpXG5cbiAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICBsZXQgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludChuYW1lKVxuICBpbXBvcnRzKG5hbWUsIG9wdHMsIGZ1bmN0aW9uKGJsdWVwcmludEZpbGUpIHtcbiAgICB0cnkge1xuXG4gICAgICBsb2coJ0JsdWVwcmludCBsb2FkZWQ6JywgYmx1ZXByaW50RmlsZS5uYW1lKVxuXG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAvLyBVcGRhdGUgZmF1eCBibHVlcHJpbnQgc3R1YiB3aXRoIHJlYWwgbW9kdWxlXG4gICAgICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIGJsdWVwcmludEZpbGUpXG5cbiAgICAgIC8vIFVwZGF0ZSBibHVlcHJpbnQgbmFtZVxuICAgICAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgYmx1ZXByaW50RmlsZS5uYW1lLCBmYWxzZSlcbiAgICAgIGJsdWVwcmludC5GcmFtZS5uYW1lID0gYmx1ZXByaW50RmlsZS5uYW1lXG5cbiAgICAgIC8vIEFwcGx5IGEgc2NoZW1hIHRvIGJsdWVwcmludFxuICAgICAgYmx1ZXByaW50ID0gQmx1ZXByaW50U2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVE9ETzogSWYgYmx1ZXByaW50IGlzIGEgbG9hZGVyLCB0aGVuIGFwcGx5IGEgZGlmZmVyZW50IHNldCBvZiBzY2hlbWEgcnVsZXNcbiAgICAgIC8vaWYgKGJsdWVwcmludC5wcm90b2NvbCA9PT0gJ2xvYWRlcicpXG4gICAgICAvLyAgYmx1ZXByaW50ID0gQmx1ZXByaW50TG9hZGVyU2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVmFsaWRhdGUgQmx1ZXByaW50IGlucHV0IHdpdGggb3B0aW9uYWwgc2FuaXRpemVycyAodXNpbmcgZGVzY3JpYmUgc3ludGF4KVxuICAgICAgYmx1ZXByaW50LmRlc2NyaWJlID0gaGVscGVycy5jcmVhdGVTYW5pdGl6ZXJzKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgbGV0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGxldCBibHVlcHJpbnQgPSBuZXcgRnJhbWUobmFtZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSBhcmd1bWVudHNcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciIsImhlbHBlcnMuY3JlYXRlU2FuaXRpemVycyJdLCJtYXBwaW5ncyI6Ijs7O0VBRUEsU0FBUyxHQUFHLEdBQUc7RUFDZjtFQUNBLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QjtFQUNBLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxL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OztFQ1hEO0VBQ0EsU0FBUyxXQUFXLENBQUMsU0FBUyxFQUFFO0VBQ2hDLEVBQUUsSUFBSSxPQUFPLFNBQVMsS0FBSyxVQUFVLEVBQUU7RUFDdkMsSUFBSSxPQUFPLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRTtFQUN2RCxHQUFHLE1BQU0sSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRO0VBQzFDLElBQUksU0FBUyxHQUFHLEdBQUU7O0VBRWxCO0VBQ0EsRUFBRSxJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBQztFQUN2QyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLFNBQVMsRUFBQzs7RUFFbEM7RUFDQSxFQUFFLEtBQUssSUFBSSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUN2QztFQUNBLElBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxVQUFVO0VBQ3pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRTtFQUNsRSxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDNUUsTUFBTSxJQUFJLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxFQUFDO0VBQ2pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUU7RUFDcEUsTUFBTSxLQUFLLElBQUksVUFBVSxJQUFJLFNBQVMsRUFBRTtFQUN4QyxRQUFRLElBQUksT0FBTyxVQUFVLEtBQUssVUFBVTtFQUM1QyxV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
