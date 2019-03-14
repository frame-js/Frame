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
          target[propertyName] = Object.create(source[propertyName], Object.getOwnPropertyDescriptors(source[propertyName]));
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

  // Destructure user input for parameter destructuring into 'props' object.
  function createDestructure(source, keys) {
    let target = {};

    // If no target exist, stub them so we don't run into issues later.
    if (!source)
      source = {};

    // Create stubs for Array of keys. Example: ['init', 'in', etc]
    for (let key of keys) {
      target[key] = [];
    }

    // Loop through source's keys
    for (let key of Object.keys(source)) {
      target[key] = [];

      // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
      if (typeof source[key] !== 'object' || Array.isArray(source[key]))
        continue

      // TODO: Support arrays for type checking
      // Example: { init: 'someKey': ['some description', 'string'] }

      let propIndex = [];
      for (let prop of Object.keys(source[key])) {
        propIndex.push({ name: prop, description: source[key][prop] });
      }

      target[key] = propIndex;
    }

    return target
  }

  function destructure(target, props) {
    props = (!props) ? [] : Array.from(props);

    if (!target)
      return props

    let targetProps = {};
    let propIndex = 0;

    // Loop through our target keys, and assign the object's key to the value of the props input.
    for (let targetProp of target) {
      targetProps[targetProp.name] = props[propIndex];
      propIndex++;
    }

    // If we don't have a valid target; return props array instead. Exemple: ['prop1', 'prop2']
    if (propIndex === 0)
      return props

    // Example: { someKey: someValue, someOtherKey: someOtherValue }
    return targetProps
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

    out: function(index, data) {
      debounce(nextPipe, 1, this, [index, null, data]);
    },

    error: function(index, err) {
      debounce(nextPipe, 1, this, [index, err]);
    },

    get value() {
      // Bail if we're not ready. (Used to get out of ObjectModel and assignObject limbo)
      if (!this.Frame)
        return ''

      const blueprint = this;
      const promiseForValue = new Promise(function(resolve, reject) {
        blueprint.Frame.isPromised = true;
        blueprint.Frame.promise = { resolve: resolve, reject: reject };
      });
      return promiseForValue
    },
  };

  function addPipe(direction, target, params) {
    if (!this)
      throw new Error('Blueprint method called without instance, did you assign the method to a variable?')

    if (!this.Frame || !this.Frame.pipes)
      throw new Error('Not working with a valid Blueprint object')

    if (typeof target !== 'function' || typeof target.to !== 'function')
      throw new Error(this.Frame.name + '.' + direction + '() was called with improper parameters')

    log(direction, '(): ' + this.name);
    this.Frame.pipes.push({ direction: direction, target: target, params: params });

    // Instance of blueprint
    if (target && target.Frame)
      target.Frame.parents.push(this);

    debounce(processFlow, 1, this);
  }

  function debounce(func, wait, blueprint, args) {
    let name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.apply(blueprint, args);
    }, wait);
  }

  function factory(fn) {
    return function() { return fn.apply(this, arguments) }
  }

  function processFlow() {
    // Already processing this Blueprint's flow.
    if (this.Frame.processingFlow)
      return

    // If no pipes for flow, then nothing to do.
    if (this.Frame.pipes.length < 1)
      return

    // Check that all blueprints are ready
    if (!flowsReady.call(this))
      return

    log('Processing flow for ' + this.name);
    console.log();
    this.Frame.processingFlow = true;

    // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
    this.Frame.pipes.unshift({ direction: 'to', target: this, params: null });

    // Break out event pipes and flow pipes into separate flows.
    let i = 1; // Start at 1, since our main blueprint instance should be 0
    for (let pipe of this.Frame.pipes) {
      let blueprint = pipe.target;
      let out = new factory(pipe.target.out);

      if (pipe.direction === 'from') {
        if (typeof blueprint.on !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')
        else {
          // .from(Events) start the flow at index 0
          pipe.target.out = out.bind(this, 0);
          this.Frame.events.push(pipe);
        }
      } else if (pipe.direction === 'to') {
        pipe.target.out = out.bind(this, i);
        this.Frame.flow.push(pipe);
        i++;
      }
    }

    startFlow.call(this);
  }

  function flowsReady() {
    // if blueprint has not been initialized yet (i.e. constructor not used.)
    if (!this.Frame.initialized) {
      initBlueprint.call(this, processFlow);
      return false
    }

    // Loop through all blueprints in flow to make sure they have been loaded and initialized.
    this.Frame.flowsReady = true;
    for (let pipe of this.Frame.pipes) {
      let target = pipe.target;
      if (!target.Frame.loaded) { // TODO: On load, need to reach out to parent to restart processFlow
        this.Frame.flowsReady = false;
        continue
      }

      if (!target.Frame.initialized) {
        initBlueprint.call(target, processFlow.bind(this));
        this.Frame.flowsReady = false;
        continue
      }
    }

    if (!this.Frame.flowsReady)
      return false

    return true
  }

  function startFlow() {
    console.log('Starting flow for ' + this.name);

    for (let event of this.Frame.events) {
      let blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);
      blueprint.on.call(blueprint, props);
    }
  }

  function nextPipe(index, err, data) {
    /*if (err)
      log.error(this.name, index, 'Error:', err)
    else
      log(this.name, index, 'out data:', data)
    */

    const flow = this.Frame.flow;
    const next = flow[index];

    // If we're at the end of the flow
    if (!next || !next.target) {
      this.Frame.processingFlow = false;

      if (this.Frame.isPromised)
        this.Frame.promise.resolve(data);

      return console.log('End of flow')
    }

    const blueprint = next.target;
    const props = destructure(blueprint.Frame.describe.in, next.params);
    blueprint.in.call(blueprint, data, props, blueprint.out);
  }

  /*
    // If blueprint is part of a flow
    let parents = this.Frame.parents
    if (parents.length >= 1) {
      for (let parent of parents) {
        console.log('Calling parent')
        parent.Frame.nextPipe.call(parent, err, data)
      }
      return
    }
  */

  function initBlueprint(callback) {
    let blueprint = this;

    try {
      let props = blueprint.Frame.props ? blueprint.Frame.props : {};

      // If Blueprint foregoes the initializer, stub it.
      if (!blueprint.init)
        blueprint.init = function(props, callback) { callback(); };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed
        log('Blueprint ' + blueprint.name + ' intialized');

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
    name: '',
    describe: ['init', 'in', 'out'],
    props: {},

    loaded: false,
    initialized: false,
    processingFlow: false,
    debounce: {},
    parents: [],

    pipes: [],
    events: [],
    flow: [],
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
    on: [Function],
    describe: [Object],

    // Internals
    out: Function,
    error: Function,
    close: [Function],

    // User facing
    to: Function,
    from: Function,
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

          var isAsync = true;
          var syncFile = null;
          if (!callback) {
            isAsync = false;
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

          scriptRequest.open('GET', filePath, isAsync);
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

        //const sandbox = { Blueprint: null }
        //vm.createContext(sandbox)
        //vm.runInContext(fileContents, sandbox)

        global.Blueprint = null;
        vm.runInThisContext(fileContents);

        callback(null, global.Blueprint);
      },

      normalizeFilePath: function(fileName) {
        const path = require('path');
        return path.resolve(process.cwd(), 'blueprints/', fileName)
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

        // Validate Blueprint input with optional property destructuring (using describe syntax)
        blueprint.Frame.describe = createDestructure(blueprint.describe, BlueprintBase.describe);

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
      // If blueprint is a singleton (for shared resources), return it instead of creating new instance.
      if (singletons[name])
        return singletons[name]

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0sIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICBlbHNlXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICAgIHRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lLFxuICAgICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHNvdXJjZSwgcHJvcGVydHlOYW1lKVxuICAgICAgKVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBzZXREZXNjcmlwdG9yKHRhcmdldCwgdmFsdWUsIGNvbmZpZ3VyYWJsZSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAndG9TdHJpbmcnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gKHZhbHVlKSA/ICdbRnJhbWU6ICcgKyB2YWx1ZSArICddJyA6ICdbRnJhbWU6IENvbnN0cnVjdG9yXSdcbiAgICB9LFxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICduYW1lJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IChjb25maWd1cmFibGUpID8gdHJ1ZSA6IGZhbHNlLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgfSlcbn1cblxuLy8gRGVzdHJ1Y3R1cmUgdXNlciBpbnB1dCBmb3IgcGFyYW1ldGVyIGRlc3RydWN0dXJpbmcgaW50byAncHJvcHMnIG9iamVjdC5cbmZ1bmN0aW9uIGNyZWF0ZURlc3RydWN0dXJlKHNvdXJjZSwga2V5cykge1xuICBsZXQgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIHNvdXJjZSdzIGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNvdXJjZSkpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG5cbiAgICAvLyBXZSBvbmx5IHN1cHBvcnQgb2JqZWN0cyBmb3Igbm93LiBFeGFtcGxlIHsgaW5pdDogeyAnc29tZUtleSc6ICdzb21lRGVzY3JpcHRpb24nIH19XG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShzb3VyY2Vba2V5XSkpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gVE9ETzogU3VwcG9ydCBhcnJheXMgZm9yIHR5cGUgY2hlY2tpbmdcbiAgICAvLyBFeGFtcGxlOiB7IGluaXQ6ICdzb21lS2V5JzogWydzb21lIGRlc2NyaXB0aW9uJywgJ3N0cmluZyddIH1cblxuICAgIGxldCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAobGV0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIGRlc3RydWN0dXJlKHRhcmdldCwgcHJvcHMpIHtcbiAgcHJvcHMgPSAoIXByb3BzKSA/IFtdIDogQXJyYXkuZnJvbShwcm9wcylcblxuICBpZiAoIXRhcmdldClcbiAgICByZXR1cm4gcHJvcHNcblxuICBsZXQgdGFyZ2V0UHJvcHMgPSB7fVxuICBsZXQgcHJvcEluZGV4ID0gMFxuXG4gIC8vIExvb3AgdGhyb3VnaCBvdXIgdGFyZ2V0IGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGxldCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBwcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgICByZXR1cm4gdGhpc1xuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBkZWJvdW5jZShuZXh0UGlwZSwgMSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGRlYm91bmNlKG5leHRQaXBlLCAxLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgZ2V0IHZhbHVlKCkge1xuICAgIC8vIEJhaWwgaWYgd2UncmUgbm90IHJlYWR5LiAoVXNlZCB0byBnZXQgb3V0IG9mIE9iamVjdE1vZGVsIGFuZCBhc3NpZ25PYmplY3QgbGltYm8pXG4gICAgaWYgKCF0aGlzLkZyYW1lKVxuICAgICAgcmV0dXJuICcnXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG4gICAgY29uc3QgcHJvbWlzZUZvclZhbHVlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9taXNlID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCB9XG4gICAgfSlcbiAgICByZXR1cm4gcHJvbWlzZUZvclZhbHVlXG4gIH0sXG59XG5cbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGluc3RhbmNlLCBkaWQgeW91IGFzc2lnbiB0aGUgbWV0aG9kIHRvIGEgdmFyaWFibGU/JylcblxuICBpZiAoIXRoaXMuRnJhbWUgfHwgIXRoaXMuRnJhbWUucGlwZXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3Qgd29ya2luZyB3aXRoIGEgdmFsaWQgQmx1ZXByaW50IG9iamVjdCcpXG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHRhcmdldC50byAhPT0gJ2Z1bmN0aW9uJylcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBsb2coZGlyZWN0aW9uLCAnKCk6ICcgKyB0aGlzLm5hbWUpXG4gIHRoaXMuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICAvLyBJbnN0YW5jZSBvZiBibHVlcHJpbnRcbiAgaWYgKHRhcmdldCAmJiB0YXJnZXQuRnJhbWUpXG4gICAgdGFyZ2V0LkZyYW1lLnBhcmVudHMucHVzaCh0aGlzKVxuXG4gIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCB0aGlzKVxufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgbGV0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIGZhY3RvcnkoZm4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkgeyByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKSB9XG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIENoZWNrIHRoYXQgYWxsIGJsdWVwcmludHMgYXJlIHJlYWR5XG4gIGlmICghZmxvd3NSZWFkeS5jYWxsKHRoaXMpKVxuICAgIHJldHVyblxuXG4gIGxvZygnUHJvY2Vzc2luZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuICBjb25zb2xlLmxvZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcywgcGFyYW1zOiBudWxsIH0pXG5cbiAgLy8gQnJlYWsgb3V0IGV2ZW50IHBpcGVzIGFuZCBmbG93IHBpcGVzIGludG8gc2VwYXJhdGUgZmxvd3MuXG4gIGxldCBpID0gMSAvLyBTdGFydCBhdCAxLCBzaW5jZSBvdXIgbWFpbiBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChsZXQgcGlwZSBvZiB0aGlzLkZyYW1lLnBpcGVzKSB7XG4gICAgbGV0IGJsdWVwcmludCA9IHBpcGUudGFyZ2V0XG4gICAgbGV0IG91dCA9IG5ldyBmYWN0b3J5KHBpcGUudGFyZ2V0Lm91dClcblxuICAgIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ2Zyb20nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5vbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50cy4nKVxuICAgICAgZWxzZSB7XG4gICAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgICBwaXBlLnRhcmdldC5vdXQgPSBvdXQuYmluZCh0aGlzLCAwKVxuICAgICAgICB0aGlzLkZyYW1lLmV2ZW50cy5wdXNoKHBpcGUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ3RvJykge1xuICAgICAgcGlwZS50YXJnZXQub3V0ID0gb3V0LmJpbmQodGhpcywgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICB0aGlzLkZyYW1lLmZsb3dzUmVhZHkgPSB0cnVlXG4gIGZvciAobGV0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGxldCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuICAgIGlmICghdGFyZ2V0LkZyYW1lLmxvYWRlZCkgeyAvLyBUT0RPOiBPbiBsb2FkLCBuZWVkIHRvIHJlYWNoIG91dCB0byBwYXJlbnQgdG8gcmVzdGFydCBwcm9jZXNzRmxvd1xuICAgICAgdGhpcy5GcmFtZS5mbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICB0aGlzLkZyYW1lLmZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMuRnJhbWUuZmxvd3NSZWFkeSlcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGNvbnNvbGUubG9nKCdTdGFydGluZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuXG4gIGZvciAobGV0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgbGV0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG4gICAgYmx1ZXByaW50Lm9uLmNhbGwoYmx1ZXByaW50LCBwcm9wcylcbiAgfVxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIC8qaWYgKGVycilcbiAgICBsb2cuZXJyb3IodGhpcy5uYW1lLCBpbmRleCwgJ0Vycm9yOicsIGVycilcbiAgZWxzZVxuICAgIGxvZyh0aGlzLm5hbWUsIGluZGV4LCAnb3V0IGRhdGE6JywgZGF0YSlcbiAgKi9cblxuICBjb25zdCBmbG93ID0gdGhpcy5GcmFtZS5mbG93XG4gIGNvbnN0IG5leHQgPSBmbG93W2luZGV4XVxuXG4gIC8vIElmIHdlJ3JlIGF0IHRoZSBlbmQgb2YgdGhlIGZsb3dcbiAgaWYgKCFuZXh0IHx8ICFuZXh0LnRhcmdldCkge1xuICAgIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSBmYWxzZVxuXG4gICAgaWYgKHRoaXMuRnJhbWUuaXNQcm9taXNlZClcbiAgICAgIHRoaXMuRnJhbWUucHJvbWlzZS5yZXNvbHZlKGRhdGEpXG5cbiAgICByZXR1cm4gY29uc29sZS5sb2coJ0VuZCBvZiBmbG93JylcbiAgfVxuXG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgYmx1ZXByaW50LmluLmNhbGwoYmx1ZXByaW50LCBkYXRhLCBwcm9wcywgYmx1ZXByaW50Lm91dClcbn1cblxuLypcbiAgLy8gSWYgYmx1ZXByaW50IGlzIHBhcnQgb2YgYSBmbG93XG4gIGxldCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gIGlmIChwYXJlbnRzLmxlbmd0aCA+PSAxKSB7XG4gICAgZm9yIChsZXQgcGFyZW50IG9mIHBhcmVudHMpIHtcbiAgICAgIGNvbnNvbGUubG9nKCdDYWxsaW5nIHBhcmVudCcpXG4gICAgICBwYXJlbnQuRnJhbWUubmV4dFBpcGUuY2FsbChwYXJlbnQsIGVyciwgZGF0YSlcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cbiovXG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcblxuICB0cnkge1xuICAgIGxldCBwcm9wcyA9IGJsdWVwcmludC5GcmFtZS5wcm9wcyA/IGJsdWVwcmludC5GcmFtZS5wcm9wcyA6IHt9XG5cbiAgICAvLyBJZiBCbHVlcHJpbnQgZm9yZWdvZXMgdGhlIGluaXRpYWxpemVyLCBzdHViIGl0LlxuICAgIGlmICghYmx1ZXByaW50LmluaXQpXG4gICAgICBibHVlcHJpbnQuaW5pdCA9IGZ1bmN0aW9uKHByb3BzLCBjYWxsYmFjaykgeyBjYWxsYmFjaygpIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludClcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBuYW1lOiAnJyxcbiAgZGVzY3JpYmU6IFsnaW5pdCcsICdpbicsICdvdXQnXSxcbiAgcHJvcHM6IHt9LFxuXG4gIGxvYWRlZDogZmFsc2UsXG4gIGluaXRpYWxpemVkOiBmYWxzZSxcbiAgcHJvY2Vzc2luZ0Zsb3c6IGZhbHNlLFxuICBkZWJvdW5jZToge30sXG4gIHBhcmVudHM6IFtdLFxuXG4gIHBpcGVzOiBbXSxcbiAgZXZlbnRzOiBbXSxcbiAgZmxvdzogW10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgbGV0IHNjaGVtYSA9IE9iamVjdC5jcmVhdGUoc2NoZW1hT2JqKVxuICBPYmplY3QuYXNzaWduKHNjaGVtYSwgc2NoZW1hT2JqKVxuXG4gIC8vIExvb3AgdGhyb3VnaCBTY2hlbWEgb2JqZWN0IGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgbGV0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChsZXQgc2NoZW1hVHlwZSBvZiBzY2hlbWFBcnIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzY2hlbWFUeXBlID09PSAnZnVuY3Rpb24nKVxuICAgICAgICAgIHNjaGVtYVtrZXldLnR5cGVzLnB1c2godHlwZW9mIHNjaGVtYVR5cGUoKSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiBzY2hlbWFba2V5XS50eXBlLCBleHBlY3RzOiBzY2hlbWFba2V5XS5leHBlY3RzIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0gfVxuICAgIH1cbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSBwcm9wc1xuICBmdW5jdGlvbiBpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpIHtcbiAgICAvLyBUT0RPOiBNYWtlIG1vcmUgZmxleGlibGUgYnkgZGVmaW5pbmcgbnVsbCBhbmQgdW5kZWZpbmVkIHR5cGVzLlxuICAgIC8vIE5vIHNjaGVtYSBkZWZpbmVkIGZvciBrZXlcbiAgICBpZiAoIXNjaGVtYVtrZXldKVxuICAgICAgcmV0dXJuIHRydWVcblxuICAgIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiB0eXBlb2YgdmFsdWUgPT09IHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmICghc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgaWYgKHZhbHVlICYmICFzY2hlbWFba2V5XS50eXBlcy5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKVxuICAgICAgICByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0uZXhwZWN0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gc2NoZW1hW2tleV0uZXhwZWN0cyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSAob25jZSBTY2hlbWEgY29uc3RydWN0b3IgaXMgY2FsbGVkKVxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGVTY2hlbWEob2JqVG9WYWxpZGF0ZSkge1xuICAgIGxldCBwcm94eU9iaiA9IHt9XG4gICAgbGV0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmpUb1ZhbGlkYXRlKSkge1xuICAgICAgY29uc3QgcHJvcERlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9ialRvVmFsaWRhdGUsIGtleSlcblxuICAgICAgLy8gUHJvcGVydHkgYWxyZWFkeSBwcm90ZWN0ZWRcbiAgICAgIGlmICghcHJvcERlc2NyaXB0b3Iud3JpdGFibGUgfHwgIXByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyBTY2hlbWEgZG9lcyBub3QgZXhpc3QgZm9yIHByb3AsIHBhc3N0aHJvdWdoXG4gICAgICBpZiAoIXNjaGVtYVtrZXldKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICB9LFxuXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBBbnkgc2NoZW1hIGxlZnRvdmVyIHNob3VsZCBiZSBhZGRlZCBiYWNrIHRvIG9iamVjdCBmb3IgZnV0dXJlIHByb3RlY3Rpb25cbiAgICAgIGZvciAobGV0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludFNjaGVtYVxuIiwiLy8gVE9ETzogTW9kdWxlRmFjdG9yeSgpIGZvciBsb2FkZXIsIHdoaWNoIHBhc3NlcyB0aGUgbG9hZGVyICsgcHJvdG9jb2wgaW50byBpdC4uIFRoYXQgd2F5IGl0J3MgcmVjdXJzaXZlLi4uXG5cbmZ1bmN0aW9uIE1vZHVsZShfX2ZpbGVuYW1lLCBmaWxlQ29udGVudHMsIGNhbGxiYWNrKSB7XG4gIC8vIEZyb20gaWlmZSBjb2RlXG4gIGlmICghZmlsZUNvbnRlbnRzKVxuICAgIF9fZmlsZW5hbWUgPSBfX2ZpbGVuYW1lLnBhdGggfHwgJydcblxuICB2YXIgbW9kdWxlID0ge1xuICAgIGZpbGVuYW1lOiBfX2ZpbGVuYW1lLFxuICAgIGV4cG9ydHM6IHt9LFxuICAgIEJsdWVwcmludDogbnVsbCxcbiAgICByZXNvbHZlOiB7fSxcblxuICAgIHJlcXVpcmU6IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gICAgfSxcbiAgfVxuXG4gIGlmICghY2FsbGJhY2spXG4gICAgcmV0dXJuIG1vZHVsZVxuXG4gIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV0gPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgZXhwb3J0cylcbiAgICBkZWxldGUgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXVxuICB9XG5cbiAgY29uc3Qgc2NyaXB0ID0gJ21vZHVsZS5yZXNvbHZlW1wiJyArIF9fZmlsZW5hbWUgKyAnXCJdKGZ1bmN0aW9uKGlpZmVNb2R1bGUpe1xcbicgK1xuICAnICB2YXIgbW9kdWxlID0gTW9kdWxlKGlpZmVNb2R1bGUpXFxuJyArXG4gICcgIHZhciBfX2ZpbGVuYW1lID0gbW9kdWxlLmZpbGVuYW1lXFxuJyArXG4gICcgIHZhciBfX2Rpcm5hbWUgPSBfX2ZpbGVuYW1lLnNsaWNlKDAsIF9fZmlsZW5hbWUubGFzdEluZGV4T2YoXCIvXCIpKVxcbicgK1xuICAnICB2YXIgcmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXFxuJyArXG4gICcgIHZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJyAgdmFyIHByb2Nlc3MgPSB7IGJyb3dzZXI6IHRydWUgfVxcbicgK1xuICAnICB2YXIgQmx1ZXByaW50ID0gbnVsbDtcXG5cXG4nICtcblxuICAnKGZ1bmN0aW9uKCkge1xcbicgKyAvLyBDcmVhdGUgSUlGRSBmb3IgbW9kdWxlL2JsdWVwcmludFxuICAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArXG4gICAgZmlsZUNvbnRlbnRzICsgJ1xcbicgK1xuICAnfSkuY2FsbChtb2R1bGUuZXhwb3J0cyk7XFxuJyArIC8vIENyZWF0ZSAndGhpcycgYmluZGluZy5cbiAgJyAgaWYgKEJsdWVwcmludCkgeyByZXR1cm4gQmx1ZXByaW50fVxcbicgK1xuICAnICByZXR1cm4gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJ30obW9kdWxlKSk7J1xuXG4gIHdpbmRvdy5tb2R1bGUgPSBtb2R1bGVcbiAgd2luZG93Lmdsb2JhbCA9IHdpbmRvd1xuICB3aW5kb3cuTW9kdWxlID0gTW9kdWxlXG5cbiAgd2luZG93LnJlcXVpcmUgPSBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgd2luZG93Lmh0dHAubW9kdWxlLmluaXQuY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUpXG4gICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgfVxuXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgbGV0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBmaWxlID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgaXNBc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgaXNBc3luYyA9IGZhbHNlXG4gICAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbihlcnIsIGZpbGUpIHtcbiAgICAgICAgICAgIGlmIChlcnIpXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnIpXG5cbiAgICAgICAgICAgIHJldHVybiBzeW5jRmlsZSA9IGZpbGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KClcblxuICAgICAgICAvLyBUT0RPOiBOZWVkcyB2YWxpZGF0aW5nIHRoYXQgZXZlbnQgaGFuZGxlcnMgd29yayBhY3Jvc3MgYnJvd3NlcnMuIE1vcmUgc3BlY2lmaWNhbGx5LCB0aGF0IHRoZXkgcnVuIG9uIEVTNSBlbnZpcm9ubWVudHMuXG4gICAgICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9YTUxIdHRwUmVxdWVzdCNCcm93c2VyX2NvbXBhdGliaWxpdHlcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gbmV3IHRoaXMuYnJvd3Nlci5zY3JpcHRFdmVudHModGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG5cbiAgICAgICAgc2NyaXB0UmVxdWVzdC5vcGVuKCdHRVQnLCBmaWxlUGF0aCwgaXNBc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIC8vY29uc3Qgc2FuZGJveCA9IHsgQmx1ZXByaW50OiBudWxsIH1cbiAgICAgIC8vdm0uY3JlYXRlQ29udGV4dChzYW5kYm94KVxuICAgICAgLy92bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuXG4gICAgICBnbG9iYWwuQmx1ZXByaW50ID0gbnVsbFxuICAgICAgdm0ucnVuSW5UaGlzQ29udGV4dChmaWxlQ29udGVudHMpXG5cbiAgICAgIGNhbGxiYWNrKG51bGwsIGdsb2JhbC5CbHVlcHJpbnQpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYmx1ZXByaW50cy8nLCBmaWxlTmFtZSlcbiAgICB9LFxuXG4gICAgcmVzb2x2ZUZpbGU6IGZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcblxuICAgICAgLy8gSWYgZmlsZSBvciBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmx1ZXByaW50IGlzIGEgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGlmIChmcy5zdGF0U3luYyhmaWxlUGF0aCkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKGZpbGVQYXRoLCAnaW5kZXguanMnKVxuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIH1cblxuICAgICAgLy8gVHJ5IGFkZGluZyBhbiBleHRlbnNpb24gdG8gc2VlIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUpKVxuICAgICAgICByZXR1cm4gZmlsZVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAobGV0IGNhbGxiYWNrIG9mIG1vZHVsZS5jYWxsYmFja3MpIHtcbiAgICBjYWxsYmFjayhtb2R1bGUubW9kdWxlKVxuICB9XG5cbiAgbW9kdWxlLmNhbGxiYWNrcyA9IFtdXG59XG5cbmNvbnN0IGltcG9ydHMgPSBmdW5jdGlvbihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IGZpbGVJbmZvID0gcmVzb2x2ZUZpbGVJbmZvKG5hbWUpXG4gICAgY29uc3QgZmlsZU5hbWUgPSBmaWxlSW5mby5uYW1lXG4gICAgY29uc3QgcHJvdG9jb2wgPSBmaWxlSW5mby5wcm90b2NvbFxuXG4gICAgbG9nKCdsb2FkaW5nIG1vZHVsZTonLCBmaWxlTmFtZSlcblxuICAgIC8vIE1vZHVsZSBoYXMgbG9hZGVkIG9yIHN0YXJ0ZWQgdG8gbG9hZFxuICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXSlcbiAgICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXS5sb2FkZWQpXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhtb2R1bGVzW2ZpbGVOYW1lXS5tb2R1bGUpIC8vIFJldHVybiBtb2R1bGUgZnJvbSBDYWNoZVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbW9kdWxlc1tmaWxlTmFtZV0uY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC8vIE5vdCBsb2FkZWQgeWV0LCByZWdpc3RlciBjYWxsYmFja1xuXG4gICAgbW9kdWxlc1tmaWxlTmFtZV0gPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXG4gICAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgY2FsbGJhY2tzOiBbY2FsbGJhY2tdLFxuICAgIH1cblxuICAgIC8vIEJvb3RzdHJhcHBpbmcgbG9hZGVyIGJsdWVwcmludHMgOylcbiAgICAvL0ZyYW1lKCdMb2FkZXJzLycgKyBwcm90b2NvbCkuZnJvbShmaWxlTmFtZSkudG8oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSkge30pXG5cbiAgICBjb25zdCBsb2FkZXIgPSAnbG9hZGVycy8nICsgcHJvdG9jb2xcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluaXQoKSAvLyBUT0RPOiBvcHRpb25hbCBpbml0IChpbnNpZGUgRnJhbWUgY29yZSlcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpe1xuICAgICAgaWYgKGVycilcbiAgICAgICAgbG9nKCdFcnJvcjogJywgZXJyLCBmaWxlTmFtZSlcbiAgICAgIGVsc2Uge1xuICAgICAgICBsb2coJ0xvYWRlZCBCbHVlcHJpbnQgbW9kdWxlOiAnLCBmaWxlTmFtZSlcblxuICAgICAgICBpZiAoIWV4cG9ydEZpbGUgfHwgdHlwZW9mIGV4cG9ydEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRGaWxlLm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IG1pc3NpbmcgYSBuYW1lJylcblxuICAgICAgICBsZXQgbW9kdWxlID0gbW9kdWxlc1tmaWxlTmFtZV1cbiAgICAgICAgaWYgKCFtb2R1bGUpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVaCBvaCwgd2Ugc2hvdWxkbnQgYmUgaGVyZScpXG5cbiAgICAgICAgLy8gTW9kdWxlIGFscmVhZHkgbG9hZGVkLiBOb3Qgc3VwcG9zZSB0byBiZSBoZXJlLiBPbmx5IGZyb20gZm9yY2UtbG9hZGluZyB3b3VsZCBnZXQgeW91IGhlcmUuXG4gICAgICAgIGlmIChtb2R1bGUubG9hZGVkKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFwiJyArIGV4cG9ydEZpbGUubmFtZSArICdcIiBhbHJlYWR5IGxvYWRlZC4nKVxuXG4gICAgICAgIG1vZHVsZS5tb2R1bGUgPSBleHBvcnRGaWxlXG4gICAgICAgIG1vZHVsZS5sb2FkZWQgPSB0cnVlXG5cbiAgICAgICAgcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gVE9ETzogbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5idW5kbGUgc3VwcG9ydCBmb3IgQ0xJIHRvb2xpbmcuXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgbG9hZCBibHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBpbXBvcnRzXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuL2V4cG9ydHMnXG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycydcbmltcG9ydCBCbHVlcHJpbnRNZXRob2RzIGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCBCbHVlcHJpbnRCYXNlIGZyb20gJy4vQmx1ZXByaW50QmFzZSdcbmltcG9ydCBCbHVlcHJpbnRTY2hlbWEgZnJvbSAnLi9zY2hlbWEnXG5pbXBvcnQgaW1wb3J0cyBmcm9tICcuL2xvYWRlcidcblxuLy8gRnJhbWUgYW5kIEJsdWVwcmludCBjb25zdHJ1Y3RvcnNcbmNvbnN0IHNpbmdsZXRvbnMgPSB7fVxuZnVuY3Rpb24gRnJhbWUobmFtZSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRnJhbWUpKVxuICAgIHJldHVybiBuZXcgRnJhbWUobmFtZSwgb3B0cylcblxuICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG5hbWUgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nKVxuXG4gIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnQobmFtZSlcbiAgaW1wb3J0cyhuYW1lLCBvcHRzLCBmdW5jdGlvbihibHVlcHJpbnRGaWxlKSB7XG4gICAgdHJ5IHtcblxuICAgICAgbG9nKCdCbHVlcHJpbnQgbG9hZGVkOicsIGJsdWVwcmludEZpbGUubmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBibHVlcHJpbnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgLy8gVXBkYXRlIGZhdXggYmx1ZXByaW50IHN0dWIgd2l0aCByZWFsIG1vZHVsZVxuICAgICAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlKVxuXG4gICAgICAvLyBVcGRhdGUgYmx1ZXByaW50IG5hbWVcbiAgICAgIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsIGJsdWVwcmludEZpbGUubmFtZSwgZmFsc2UpXG4gICAgICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IGJsdWVwcmludEZpbGUubmFtZVxuXG4gICAgICAvLyBBcHBseSBhIHNjaGVtYSB0byBibHVlcHJpbnRcbiAgICAgIGJsdWVwcmludCA9IEJsdWVwcmludFNjaGVtYShibHVlcHJpbnQpXG5cbiAgICAgIC8vIFZhbGlkYXRlIEJsdWVwcmludCBpbnB1dCB3aXRoIG9wdGlvbmFsIHByb3BlcnR5IGRlc3RydWN0dXJpbmcgKHVzaW5nIGRlc2NyaWJlIHN5bnRheClcbiAgICAgIGJsdWVwcmludC5GcmFtZS5kZXNjcmliZSA9IGhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUoYmx1ZXByaW50LmRlc2NyaWJlLCBCbHVlcHJpbnRCYXNlLmRlc2NyaWJlKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBsZXQgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgICBsZXQgYmx1ZXByaW50ID0gbmV3IEZyYW1lKG5hbWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0gYXJndW1lbnRzXG5cbiAgICByZXR1cm4gYmx1ZXByaW50XG4gIH1cbn1cblxuLy8gR2l2ZSBGcmFtZSBhbiBlYXN5IGRlc2NyaXB0b3JcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZSwgJ0NvbnN0cnVjdG9yJylcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZS5jb25zdHJ1Y3RvciwgJ0ZyYW1lJylcblxuLy8gRXhwb3J0IEZyYW1lIGdsb2JhbGx5XG5leHBvcnRlcignRnJhbWUnLCBGcmFtZSlcbmV4cG9ydCBkZWZhdWx0IEZyYW1lXG4iXSwibmFtZXMiOlsiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUs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QUFXLENBQUMsU0FBUyxFQUFFO0VBQ2hDLEVBQUUsSUFBSSxPQUFPLFNBQVMsS0FBSyxVQUFVLEVBQUU7RUFDdkMsSUFBSSxPQUFPLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRTtFQUN2RCxHQUFHLE1BQU0sSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRO0VBQzFDLElBQUksU0FBUyxHQUFHLEdBQUU7O0VBRWxCO0VBQ0EsRUFBRSxJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBQztFQUN2QyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLFNBQVMsRUFBQzs7RUFFbEM7RUFDQSxFQUFFLEtBQUssSUFBSSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUN2QztFQUNBLElBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxVQUFVO0VBQ3pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRTtFQUNsRSxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDNUUsTUFBTSxJQUFJLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxFQUFDO0VBQ2pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUU7RUFDcEUsTUFBTSxLQUFLLElBQUksVUFBVSxJQUFJLFNBQVMsRUFBRTtFQUN4QyxRQUFRLElBQUksT0FBTyxVQUFVLEtBQUssVUFBVTtFQUM1QyxVQUFVLE1BQU0sQ0FBQyxHQUFH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
