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

    /*get value() {
      this.Frame.isPromised = true
      this.Frame.promise = new Promise()
      return this.Frame.promise
    },*/
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGxldCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0sIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICBlbHNlXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICAgIHRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lLFxuICAgICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHNvdXJjZSwgcHJvcGVydHlOYW1lKVxuICAgICAgKVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBzZXREZXNjcmlwdG9yKHRhcmdldCwgdmFsdWUsIGNvbmZpZ3VyYWJsZSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAndG9TdHJpbmcnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gKHZhbHVlKSA/ICdbRnJhbWU6ICcgKyB2YWx1ZSArICddJyA6ICdbRnJhbWU6IENvbnN0cnVjdG9yXSdcbiAgICB9LFxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICduYW1lJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IChjb25maWd1cmFibGUpID8gdHJ1ZSA6IGZhbHNlLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgfSlcbn1cblxuLy8gRGVzdHJ1Y3R1cmUgdXNlciBpbnB1dCBmb3IgcGFyYW1ldGVyIGRlc3RydWN0dXJpbmcgaW50byAncHJvcHMnIG9iamVjdC5cbmZ1bmN0aW9uIGNyZWF0ZURlc3RydWN0dXJlKHNvdXJjZSwga2V5cykge1xuICBsZXQgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIHNvdXJjZSdzIGtleXNcbiAgZm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKHNvdXJjZSkpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG5cbiAgICAvLyBXZSBvbmx5IHN1cHBvcnQgb2JqZWN0cyBmb3Igbm93LiBFeGFtcGxlIHsgaW5pdDogeyAnc29tZUtleSc6ICdzb21lRGVzY3JpcHRpb24nIH19XG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShzb3VyY2Vba2V5XSkpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gVE9ETzogU3VwcG9ydCBhcnJheXMgZm9yIHR5cGUgY2hlY2tpbmdcbiAgICAvLyBFeGFtcGxlOiB7IGluaXQ6ICdzb21lS2V5JzogWydzb21lIGRlc2NyaXB0aW9uJywgJ3N0cmluZyddIH1cblxuICAgIGxldCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAobGV0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIGRlc3RydWN0dXJlKHRhcmdldCwgcHJvcHMpIHtcbiAgcHJvcHMgPSAoIXByb3BzKSA/IFtdIDogQXJyYXkuZnJvbShwcm9wcylcblxuICBpZiAoIXRhcmdldClcbiAgICByZXR1cm4gcHJvcHNcblxuICBsZXQgdGFyZ2V0UHJvcHMgPSB7fVxuICBsZXQgcHJvcEluZGV4ID0gMFxuXG4gIC8vIExvb3AgdGhyb3VnaCBvdXIgdGFyZ2V0IGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGxldCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBwcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgICByZXR1cm4gdGhpc1xuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBkZWJvdW5jZShuZXh0UGlwZSwgMSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGRlYm91bmNlKG5leHRQaXBlLCAxLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgLypnZXQgdmFsdWUoKSB7XG4gICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gdHJ1ZVxuICAgIHRoaXMuRnJhbWUucHJvbWlzZSA9IG5ldyBQcm9taXNlKClcbiAgICByZXR1cm4gdGhpcy5GcmFtZS5wcm9taXNlXG4gIH0sKi9cbn1cblxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgaW5zdGFuY2UsIGRpZCB5b3UgYXNzaWduIHRoZSBtZXRob2QgdG8gYSB2YXJpYWJsZT8nKVxuXG4gIGlmICghdGhpcy5GcmFtZSB8fCAhdGhpcy5GcmFtZS5waXBlcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCB3b3JraW5nIHdpdGggYSB2YWxpZCBCbHVlcHJpbnQgb2JqZWN0JylcblxuICBpZiAodHlwZW9mIHRhcmdldCAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgdGFyZ2V0LnRvICE9PSAnZnVuY3Rpb24nKVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGxvZyhkaXJlY3Rpb24sICcoKTogJyArIHRoaXMubmFtZSlcbiAgdGhpcy5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuXG4gIC8vIEluc3RhbmNlIG9mIGJsdWVwcmludFxuICBpZiAodGFyZ2V0ICYmIHRhcmdldC5GcmFtZSlcbiAgICB0YXJnZXQuRnJhbWUucGFyZW50cy5wdXNoKHRoaXMpXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIHRoaXMpXG59XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZ1bmMsIHdhaXQsIGJsdWVwcmludCwgYXJncykge1xuICBsZXQgbmFtZSA9IGZ1bmMubmFtZVxuICBjbGVhclRpbWVvdXQoYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdKVxuICBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0gPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV1cbiAgICBmdW5jLmFwcGx5KGJsdWVwcmludCwgYXJncylcbiAgfSwgd2FpdClcbn1cblxuZnVuY3Rpb24gZmFjdG9yeShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7IHJldHVybiBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpIH1cbn1cblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGNvbnNvbGUubG9nKClcbiAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IHRydWVcblxuICAvLyBQdXQgdGhpcyBibHVlcHJpbnQgYXQgdGhlIGJlZ2lubmluZyBvZiB0aGUgZmxvdywgdGhhdCB3YXkgYW55IC5mcm9tIGV2ZW50cyB0cmlnZ2VyIHRoZSB0b3AgbGV2ZWwgZmlyc3QuXG4gIHRoaXMuRnJhbWUucGlwZXMudW5zaGlmdCh7IGRpcmVjdGlvbjogJ3RvJywgdGFyZ2V0OiB0aGlzLCBwYXJhbXM6IG51bGwgfSlcblxuICAvLyBCcmVhayBvdXQgZXZlbnQgcGlwZXMgYW5kIGZsb3cgcGlwZXMgaW50byBzZXBhcmF0ZSBmbG93cy5cbiAgbGV0IGkgPSAxIC8vIFN0YXJ0IGF0IDEsIHNpbmNlIG91ciBtYWluIGJsdWVwcmludCBpbnN0YW5jZSBzaG91bGQgYmUgMFxuICBmb3IgKGxldCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBsZXQgYmx1ZXByaW50ID0gcGlwZS50YXJnZXRcbiAgICBsZXQgb3V0ID0gbmV3IGZhY3RvcnkocGlwZS50YXJnZXQub3V0KVxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG4gICAgICBlbHNlIHtcbiAgICAgICAgLy8gLmZyb20oRXZlbnRzKSBzdGFydCB0aGUgZmxvdyBhdCBpbmRleCAwXG4gICAgICAgIHBpcGUudGFyZ2V0Lm91dCA9IG91dC5iaW5kKHRoaXMsIDApXG4gICAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBwaXBlLnRhcmdldC5vdXQgPSBvdXQuYmluZCh0aGlzLCBpKVxuICAgICAgdGhpcy5GcmFtZS5mbG93LnB1c2gocGlwZSlcbiAgICAgIGkrK1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0Rmxvdy5jYWxsKHRoaXMpXG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIHRoaXMuRnJhbWUuZmxvd3NSZWFkeSA9IHRydWVcbiAgZm9yIChsZXQgcGlwZSBvZiB0aGlzLkZyYW1lLnBpcGVzKSB7XG4gICAgbGV0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG4gICAgaWYgKCF0YXJnZXQuRnJhbWUubG9hZGVkKSB7IC8vIFRPRE86IE9uIGxvYWQsIG5lZWQgdG8gcmVhY2ggb3V0IHRvIHBhcmVudCB0byByZXN0YXJ0IHByb2Nlc3NGbG93XG4gICAgICB0aGlzLkZyYW1lLmZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvd3NSZWFkeSA9IGZhbHNlXG4gICAgICBjb250aW51ZVxuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5GcmFtZS5mbG93c1JlYWR5KVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiB0cnVlXG59XG5cbmZ1bmN0aW9uIHN0YXJ0RmxvdygpIHtcbiAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG5cbiAgZm9yIChsZXQgZXZlbnQgb2YgdGhpcy5GcmFtZS5ldmVudHMpIHtcbiAgICBsZXQgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcbiAgICBibHVlcHJpbnQub24uY2FsbChibHVlcHJpbnQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIG5leHRQaXBlKGluZGV4LCBlcnIsIGRhdGEpIHtcbiAgLyppZiAoZXJyKVxuICAgIGxvZy5lcnJvcih0aGlzLm5hbWUsIGluZGV4LCAnRXJyb3I6JywgZXJyKVxuICBlbHNlXG4gICAgbG9nKHRoaXMubmFtZSwgaW5kZXgsICdvdXQgZGF0YTonLCBkYXRhKVxuICAqL1xuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG4gICAgcmV0dXJuIGNvbnNvbGUubG9nKCdFbmQgb2YgZmxvdycpXG4gIH1cblxuICBjb25zdCBibHVlcHJpbnQgPSBuZXh0LnRhcmdldFxuICBjb25zdCBwcm9wcyA9IGRlc3RydWN0dXJlKGJsdWVwcmludC5GcmFtZS5kZXNjcmliZS5pbiwgbmV4dC5wYXJhbXMpXG4gIGJsdWVwcmludC5pbi5jYWxsKGJsdWVwcmludCwgZGF0YSwgcHJvcHMsIGJsdWVwcmludC5vdXQpXG59XG5cbi8qXG4gIC8vIElmIGJsdWVwcmludCBpcyBwYXJ0IG9mIGEgZmxvd1xuICBsZXQgcGFyZW50cyA9IHRoaXMuRnJhbWUucGFyZW50c1xuICBpZiAocGFyZW50cy5sZW5ndGggPj0gMSkge1xuICAgIGZvciAobGV0IHBhcmVudCBvZiBwYXJlbnRzKSB7XG4gICAgICBjb25zb2xlLmxvZygnQ2FsbGluZyBwYXJlbnQnKVxuICAgICAgcGFyZW50LkZyYW1lLm5leHRQaXBlLmNhbGwocGFyZW50LCBlcnIsIGRhdGEpXG4gICAgfVxuICAgIHJldHVyblxuICB9XG4qL1xuXG5mdW5jdGlvbiBpbml0Qmx1ZXByaW50KGNhbGxiYWNrKSB7XG4gIGxldCBibHVlcHJpbnQgPSB0aGlzXG5cbiAgdHJ5IHtcbiAgICBsZXQgcHJvcHMgPSBibHVlcHJpbnQuRnJhbWUucHJvcHMgPyBibHVlcHJpbnQuRnJhbWUucHJvcHMgOiB7fVxuXG4gICAgLy8gSWYgQmx1ZXByaW50IGZvcmVnb2VzIHRoZSBpbml0aWFsaXplciwgc3R1YiBpdC5cbiAgICBpZiAoIWJsdWVwcmludC5pbml0KVxuICAgICAgYmx1ZXByaW50LmluaXQgPSBmdW5jdGlvbihwcm9wcywgY2FsbGJhY2spIHsgY2FsbGJhY2soKSB9XG5cbiAgICBwcm9wcyA9IGRlc3RydWN0dXJlKGJsdWVwcmludC5GcmFtZS5kZXNjcmliZS5pbml0LCBwcm9wcylcbiAgICBibHVlcHJpbnQuaW5pdC5jYWxsKGJsdWVwcmludCwgcHJvcHMsIGZ1bmN0aW9uKGVycikge1xuICAgICAgaWYgKGVycilcbiAgICAgICAgcmV0dXJuIGxvZygnRXJyb3IgaW5pdGlhbGl6aW5nIGJsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnXFxuJyArIGVycilcblxuICAgICAgLy8gQmx1ZXByaW50IGludGl0aWFsemVkXG4gICAgICBsb2coJ0JsdWVwcmludCAnICsgYmx1ZXByaW50Lm5hbWUgKyAnIGludGlhbGl6ZWQnKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSB7fVxuICAgICAgYmx1ZXByaW50LkZyYW1lLmluaXRpYWxpemVkID0gdHJ1ZVxuICAgICAgY2FsbGJhY2sgJiYgY2FsbGJhY2suY2FsbChibHVlcHJpbnQpXG4gICAgfSlcblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGNvdWxkIG5vdCBpbml0aWFsaXplLlxcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50TWV0aG9kc1xuZXhwb3J0IHsgQmx1ZXByaW50TWV0aG9kcywgZGVib3VuY2UsIHByb2Nlc3NGbG93IH1cbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBJbnRlcm5hbCBGcmFtZSBwcm9wc1xuY29uc3QgQmx1ZXByaW50QmFzZSA9IHtcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sXG4gIHByb3BzOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgZGVib3VuY2U6IHt9LFxuICBwYXJlbnRzOiBbXSxcblxuICBwaXBlczogW10sXG4gIGV2ZW50czogW10sXG4gIGZsb3c6IFtdLFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRCYXNlXG4iLCIndXNlIHN0cmljdCdcblxuLy8gQ29uY2VwdCBiYXNlZCBvbjogaHR0cDovL29iamVjdG1vZGVsLmpzLm9yZy9cbmZ1bmN0aW9uIE9iamVjdE1vZGVsKHNjaGVtYU9iaikge1xuICBpZiAodHlwZW9mIHNjaGVtYU9iaiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB7IHR5cGU6IHNjaGVtYU9iai5uYW1lLCBleHBlY3RzOiBzY2hlbWFPYmogfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFPYmogIT09ICdvYmplY3QnKVxuICAgIHNjaGVtYU9iaiA9IHt9XG5cbiAgLy8gQ2xvbmUgc2NoZW1hIG9iamVjdCBzbyB3ZSBkb24ndCBtdXRhdGUgaXQuXG4gIGxldCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAobGV0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGxldCBzY2hlbWFBcnIgPSBzY2hlbWFba2V5XVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ29wdGlvbmFsJywgdHlwZXM6IFtdIH1cbiAgICAgIGZvciAobGV0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBsZXQgcHJveHlPYmogPSB7fVxuICAgIGxldCBvYmogPSBvYmpUb1ZhbGlkYXRlXG5cbiAgICBmb3IgKGxldCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGxldCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBvbjogW0Z1bmN0aW9uXSxcbiAgZGVzY3JpYmU6IFtPYmplY3RdLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIFVzZXIgZmFjaW5nXG4gIHRvOiBGdW5jdGlvbixcbiAgZnJvbTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICAgIH0sXG4gIH1cblxuICBpZiAoIWNhbGxiYWNrKVxuICAgIHJldHVybiBtb2R1bGVcblxuICBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdID0gZnVuY3Rpb24oZXhwb3J0cykge1xuICAgIGNhbGxiYWNrKG51bGwsIGV4cG9ydHMpXG4gICAgZGVsZXRlIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV1cbiAgfVxuXG4gIGNvbnN0IHNjcmlwdCA9ICdtb2R1bGUucmVzb2x2ZVtcIicgKyBfX2ZpbGVuYW1lICsgJ1wiXShmdW5jdGlvbihpaWZlTW9kdWxlKXtcXG4nICtcbiAgJyAgdmFyIG1vZHVsZSA9IE1vZHVsZShpaWZlTW9kdWxlKVxcbicgK1xuICAnICB2YXIgX19maWxlbmFtZSA9IG1vZHVsZS5maWxlbmFtZVxcbicgK1xuICAnICB2YXIgX19kaXJuYW1lID0gX19maWxlbmFtZS5zbGljZSgwLCBfX2ZpbGVuYW1lLmxhc3RJbmRleE9mKFwiL1wiKSlcXG4nICtcbiAgJyAgdmFyIHJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxcbicgK1xuICAnICB2YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICcgIHZhciBwcm9jZXNzID0geyBicm93c2VyOiB0cnVlIH1cXG4nICtcbiAgJyAgdmFyIEJsdWVwcmludCA9IG51bGw7XFxuXFxuJyArXG5cbiAgJyhmdW5jdGlvbigpIHtcXG4nICsgLy8gQ3JlYXRlIElJRkUgZm9yIG1vZHVsZS9ibHVlcHJpbnRcbiAgJ1widXNlIHN0cmljdFwiO1xcbicgK1xuICAgIGZpbGVDb250ZW50cyArICdcXG4nICtcbiAgJ30pLmNhbGwobW9kdWxlLmV4cG9ydHMpO1xcbicgKyAvLyBDcmVhdGUgJ3RoaXMnIGJpbmRpbmcuXG4gICcgIGlmIChCbHVlcHJpbnQpIHsgcmV0dXJuIEJsdWVwcmludH1cXG4nICtcbiAgJyAgcmV0dXJuIG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICd9KG1vZHVsZSkpOydcblxuICB3aW5kb3cubW9kdWxlID0gbW9kdWxlXG4gIHdpbmRvdy5nbG9iYWwgPSB3aW5kb3dcbiAgd2luZG93Lk1vZHVsZSA9IE1vZHVsZVxuXG4gIHdpbmRvdy5yZXF1aXJlID0gZnVuY3Rpb24odXJsLCBjYWxsYmFjaykge1xuICAgIHdpbmRvdy5odHRwLm1vZHVsZS5pbml0LmNhbGwod2luZG93Lmh0dHAubW9kdWxlKVxuICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gIH1cblxuXG4gIHJldHVybiBzY3JpcHRcbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9kdWxlXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5pbXBvcnQgTW9kdWxlIGZyb20gJy4uLy4uL2xpYi9Nb2R1bGVMb2FkZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi4vLi4vbGliL2V4cG9ydHMnXG5cbi8vIEVtYmVkZGVkIGh0dHAgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGh0dHBMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2h0dHAnLFxuICBwcm90b2NvbDogJ2xvYWRlcicsIC8vIGVtYmVkZGVkIGxvYWRlclxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdIVFRQIExvYWRlcicsXG4gICAgcHJvdG9jb2w6IFsnaHR0cCcsICdodHRwcycsICd3ZWI6Ly8nXSwgLy8gVE9ETzogQ3JlYXRlIGEgd2F5IGZvciBsb2FkZXIgdG8gc3Vic2NyaWJlIHRvIG11bHRpcGxlIHByb3RvY29sc1xuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKCF0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdVUkwgbG9hZGluZyB3aXRoIG5vZGUuanMgbm90IHN1cHBvcnRlZCB5ZXQgKENvbWluZyBzb29uISkuJylcblxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3Nlci5sb2FkLmNhbGwodGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCdodHRwJykgPj0gMClcbiAgICAgICAgcmV0dXJuIGZpbGVOYW1lXG5cbiAgICAgIGxldCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgZmlsZSA9ICdibHVlcHJpbnRzLycgKyBmaWxlXG4gICAgICByZXR1cm4gZmlsZVxuICAgIH0sXG5cbiAgICBicm93c2VyOiB7XG4gICAgICBsb2FkOiBmdW5jdGlvbihmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuICAgICAgICBsb2coJ1todHRwIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZVBhdGgpXG5cbiAgICAgICAgdmFyIGlzQXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGlzQXN5bmMgPSBmYWxzZVxuICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCBmaWxlKSB7XG4gICAgICAgICAgICBpZiAoZXJyKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyKVxuXG4gICAgICAgICAgICByZXR1cm4gc3luY0ZpbGUgPSBmaWxlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgICAgLy8gVE9ETzogTmVlZHMgdmFsaWRhdGluZyB0aGF0IGV2ZW50IGhhbmRsZXJzIHdvcmsgYWNyb3NzIGJyb3dzZXJzLiBNb3JlIHNwZWNpZmljYWxseSwgdGhhdCB0aGV5IHJ1biBvbiBFUzUgZW52aXJvbm1lbnRzLlxuICAgICAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvWE1MSHR0cFJlcXVlc3QjQnJvd3Nlcl9jb21wYXRpYmlsaXR5XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IG5ldyB0aGlzLmJyb3dzZXIuc2NyaXB0RXZlbnRzKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuXG4gICAgICAgIHNjcmlwdFJlcXVlc3Qub3BlbignR0VUJywgZmlsZVBhdGgsIGlzQXN5bmMpXG4gICAgICAgIHNjcmlwdFJlcXVlc3Quc2VuZChudWxsKVxuXG4gICAgICAgIHJldHVybiBzeW5jRmlsZVxuICAgICAgfSxcblxuICAgICAgc2NyaXB0RXZlbnRzOiBmdW5jdGlvbihsb2FkZXIsIGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5maWxlTmFtZSA9IGZpbGVOYW1lXG4gICAgICAgIHRoaXMub25Mb2FkID0gbG9hZGVyLmJyb3dzZXIub25Mb2FkLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgICB0aGlzLm9uRXJyb3IgPSBsb2FkZXIuYnJvd3Nlci5vbkVycm9yLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgfSxcblxuICAgICAgb25Mb2FkOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IHRoaXNcblxuICAgICAgICAgIGlmIChzY3JpcHRSZXF1ZXN0LnN0YXR1cyA+IDQwMClcbiAgICAgICAgICAgIHJldHVybiBzY3JpcHRFdmVudHMub25FcnJvci5jYWxsKHNjcmlwdFJlcXVlc3QsIHNjcmlwdFJlcXVlc3Quc3RhdHVzVGV4dClcblxuICAgICAgICAgIGNvbnN0IHNjcmlwdENvbnRlbnQgPSBNb2R1bGUoc2NyaXB0UmVxdWVzdC5yZXNwb25zZVVSTCwgc2NyaXB0UmVxdWVzdC5yZXNwb25zZVRleHQsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcblxuICAgICAgICAgIHZhciBodG1sID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XG4gICAgICAgICAgdmFyIHNjcmlwdFRhZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpXG4gICAgICAgICAgc2NyaXB0VGFnLnRleHRDb250ZW50ID0gc2NyaXB0Q29udGVudFxuXG4gICAgICAgICAgaHRtbC5hcHBlbmRDaGlsZChzY3JpcHRUYWcpXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgb25FcnJvcjogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBzY3JpcHRFdmVudHMuZmlsZU5hbWVcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0VGFnID0gdGhpc1xuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG5cbiAgICAgICAgICAvLyBUcnkgdG8gZmFsbGJhY2sgdG8gaW5kZXguanNcbiAgICAgICAgICAvLyBGSVhNRTogaW5zdGVhZCBvZiBmYWxsaW5nIGJhY2ssIHRoaXMgc2hvdWxkIGJlIHRoZSBkZWZhdWx0IGlmIG5vIGAuanNgIGlzIGRldGVjdGVkLCBidXQgVVJMIHVnbGlmaWVycyBhbmQgc3VjaCB3aWxsIGhhdmUgaXNzdWVzLi4gaHJtbW1tLi5cbiAgICAgICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xICYmIGZpbGVOYW1lLmluZGV4T2YoJ2luZGV4LmpzJykgPT09IC0xKSB7XG4gICAgICAgICAgICBsb2cud2FybignW2h0dHBdIEF0dGVtcHRpbmcgdG8gZmFsbGJhY2sgdG86ICcsIGZpbGVOYW1lICsgJy9pbmRleC5qcycpXG4gICAgICAgICAgICByZXR1cm4gbG9hZGVyLmluLmNhbGwobG9hZGVyLCBmaWxlTmFtZSArICcvaW5kZXguanMnLCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKCdDb3VsZCBub3QgbG9hZCBCbHVlcHJpbnQnKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBjbGVhbnVwOiBmdW5jdGlvbihzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cykge1xuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuICAgICAgICAvL2RvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdoZWFkJylbMF0ucmVtb3ZlQ2hpbGQoc2NyaXB0VGFnKSAvLyBUT0RPOiBDbGVhbnVwXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICBub2RlOiB7XG4gICAgICAvLyBTdHViIGZvciBub2RlLmpzIEhUVFAgbG9hZGluZyBzdXBwb3J0LlxuICAgIH0sXG5cbiAgfSxcbn1cblxuZXhwb3J0ZXIoJ2h0dHAnLCBodHRwTG9hZGVyKSAvLyBUT0RPOiBDbGVhbnVwLCBleHBvc2UgbW9kdWxlcyBpbnN0ZWFkXG5cbmV4cG9ydCBkZWZhdWx0IGh0dHBMb2FkZXJcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcblxuLy8gRW1iZWRkZWQgZmlsZSBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgZmlsZUxvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvZmlsZScsXG4gIHByb3RvY29sOiAnZW1iZWQnLFxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdGaWxlIExvYWRlcicsXG4gICAgcHJvdG9jb2w6ICdmaWxlJyxcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICh0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlOi8vIGxvYWRpbmcgd2l0aGluIGJyb3dzZXIgbm90IHN1cHBvcnRlZCB5ZXQuIFRyeSByZWxhdGl2ZSBVUkwgaW5zdGVhZC4nKVxuXG4gICAgICBsb2coJ1tmaWxlIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZU5hbWUpXG5cbiAgICAgIC8vIFRPRE86IFN3aXRjaCB0byBhc3luYyBmaWxlIGxvYWRpbmcsIGltcHJvdmUgcmVxdWlyZSgpLCBwYXNzIGluIElJRkUgdG8gc2FuZGJveCwgdXNlIElJRkUgcmVzb2x2ZXIgZm9yIGNhbGxiYWNrXG4gICAgICAvLyBUT0RPOiBBZGQgZXJyb3IgcmVwb3J0aW5nLlxuXG4gICAgICBjb25zdCB2bSA9IHJlcXVpcmUoJ3ZtJylcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG5cbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnJlc29sdmVGaWxlKGZpbGVQYXRoKVxuICAgICAgaWYgKCFmaWxlKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ0JsdWVwcmludCBub3QgZm91bmQnKVxuXG4gICAgICBjb25zdCBmaWxlQ29udGVudHMgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZSkudG9TdHJpbmcoKVxuXG4gICAgICAvL2NvbnN0IHNhbmRib3ggPSB7IEJsdWVwcmludDogbnVsbCB9XG4gICAgICAvL3ZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIC8vdm0ucnVuSW5Db250ZXh0KGZpbGVDb250ZW50cywgc2FuZGJveClcblxuICAgICAgZ2xvYmFsLkJsdWVwcmludCA9IG51bGxcbiAgICAgIHZtLnJ1bkluVGhpc0NvbnRleHQoZmlsZUNvbnRlbnRzKVxuXG4gICAgICBjYWxsYmFjayhudWxsLCBnbG9iYWwuQmx1ZXByaW50KVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcbiAgICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcblxuICAgIHJlc29sdmVGaWxlOiBmdW5jdGlvbihmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG5cbiAgICAgIC8vIElmIGZpbGUgb3IgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIGJsdWVwcmludCBpcyBhIGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMoZmlsZVBhdGgpLmlzRGlyZWN0b3J5KCkpXG4gICAgICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShmaWxlUGF0aCwgJ2luZGV4LmpzJylcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHJldHVybiBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICB9XG5cbiAgICAgIC8vIFRyeSBhZGRpbmcgYW4gZXh0ZW5zaW9uIHRvIHNlZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSlcbiAgICAgICAgcmV0dXJuIGZpbGVcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9LFxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGZpbGVMb2FkZXJcbiIsIi8qIGVzbGludC1kaXNhYmxlIHByZWZlci10ZW1wbGF0ZSAqL1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBodHRwTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwJ1xuaW1wb3J0IGZpbGVMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUnXG5cbi8vIE11bHRpLWVudmlyb25tZW50IGFzeW5jIG1vZHVsZSBsb2FkZXJcbmNvbnN0IG1vZHVsZXMgPSB7XG4gICdsb2FkZXJzL2h0dHAnOiBodHRwTG9hZGVyLFxuICAnbG9hZGVycy9maWxlJzogZmlsZUxvYWRlcixcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gIC8vIFRPRE86IGxvb3AgdGhyb3VnaCBlYWNoIGZpbGUgcGF0aCBhbmQgbm9ybWFsaXplIGl0IHRvbzpcbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkvLy5jYXBpdGFsaXplKClcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUZpbGVJbmZvKGZpbGUpIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVOYW1lID0gbm9ybWFsaXplTmFtZShmaWxlKVxuICBjb25zdCBwcm90b2NvbCA9IHBhcnNlUHJvdG9jb2woZmlsZSlcblxuICByZXR1cm4ge1xuICAgIGZpbGU6IGZpbGUsXG4gICAgcGF0aDogZmlsZSxcbiAgICBuYW1lOiBub3JtYWxpemVkRmlsZU5hbWUsXG4gICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvdG9jb2wobmFtZSkge1xuICAvLyBGSVhNRTogbmFtZSBzaG91bGQgb2YgYmVlbiBub3JtYWxpemVkIGJ5IG5vdy4gRWl0aGVyIHJlbW92ZSB0aGlzIGNvZGUgb3IgbW92ZSBpdCBzb21ld2hlcmUgZWxzZS4uXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxvYWRlciBibHVlcHJpbnQgbmFtZScpXG5cbiAgdmFyIHByb3RvUmVzdWx0cyA9IG5hbWUubWF0Y2goLzpcXC9cXC8vZ2kpICYmIG5hbWUuc3BsaXQoLzpcXC9cXC8vZ2kpXG5cbiAgLy8gTm8gcHJvdG9jb2wgZm91bmQsIGlmIGJyb3dzZXIgZW52aXJvbm1lbnQgdGhlbiBpcyByZWxhdGl2ZSBVUkwgZWxzZSBpcyBhIGZpbGUgcGF0aC4gKFNhbmUgZGVmYXVsdHMgYnV0IGNhbiBiZSBvdmVycmlkZGVuKVxuICBpZiAoIXByb3RvUmVzdWx0cylcbiAgICByZXR1cm4gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/ICdodHRwJyA6ICdmaWxlJ1xuXG4gIHJldHVybiBwcm90b1Jlc3VsdHNbMF1cbn1cblxuZnVuY3Rpb24gcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSkge1xuICBmb3IgKGxldCBjYWxsYmFjayBvZiBtb2R1bGUuY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2sobW9kdWxlLm1vZHVsZSlcbiAgfVxuXG4gIG1vZHVsZS5jYWxsYmFja3MgPSBbXVxufVxuXG5jb25zdCBpbXBvcnRzID0gZnVuY3Rpb24obmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlSW5mbyA9IHJlc29sdmVGaWxlSW5mbyhuYW1lKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gZmlsZUluZm8ubmFtZVxuICAgIGNvbnN0IHByb3RvY29sID0gZmlsZUluZm8ucHJvdG9jb2xcblxuICAgIGxvZygnbG9hZGluZyBtb2R1bGU6JywgZmlsZU5hbWUpXG5cbiAgICAvLyBNb2R1bGUgaGFzIGxvYWRlZCBvciBzdGFydGVkIHRvIGxvYWRcbiAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0pXG4gICAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0ubG9hZGVkKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2sobW9kdWxlc1tmaWxlTmFtZV0ubW9kdWxlKSAvLyBSZXR1cm4gbW9kdWxlIGZyb20gQ2FjaGVcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG1vZHVsZXNbZmlsZU5hbWVdLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAvLyBOb3QgbG9hZGVkIHlldCwgcmVnaXN0ZXIgY2FsbGJhY2tcblxuICAgIG1vZHVsZXNbZmlsZU5hbWVdID0ge1xuICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxuICAgICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICAgICAgbG9hZGVkOiBmYWxzZSxcbiAgICAgIGNhbGxiYWNrczogW2NhbGxiYWNrXSxcbiAgICB9XG5cbiAgICAvLyBCb290c3RyYXBwaW5nIGxvYWRlciBibHVlcHJpbnRzIDspXG4gICAgLy9GcmFtZSgnTG9hZGVycy8nICsgcHJvdG9jb2wpLmZyb20oZmlsZU5hbWUpLnRvKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpIHt9KVxuXG4gICAgY29uc3QgbG9hZGVyID0gJ2xvYWRlcnMvJyArIHByb3RvY29sXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbml0KCkgLy8gVE9ETzogb3B0aW9uYWwgaW5pdCAoaW5zaWRlIEZyYW1lIGNvcmUpXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbihmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKXtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIGxvZygnRXJyb3I6ICcsIGVyciwgZmlsZU5hbWUpXG4gICAgICBlbHNlIHtcbiAgICAgICAgbG9nKCdMb2FkZWQgQmx1ZXByaW50IG1vZHVsZTogJywgZmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKCFleHBvcnRGaWxlIHx8IHR5cGVvZiBleHBvcnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0RmlsZS5uYW1lICE9PSAnc3RyaW5nJylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBtaXNzaW5nIGEgbmFtZScpXG5cbiAgICAgICAgbGV0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBWYWxpZGF0ZSBCbHVlcHJpbnQgaW5wdXQgd2l0aCBvcHRpb25hbCBwcm9wZXJ0eSBkZXN0cnVjdHVyaW5nICh1c2luZyBkZXNjcmliZSBzeW50YXgpXG4gICAgICBibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUgPSBoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgbGV0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gICAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gICAgbGV0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgcmV0dXJuIGJsdWVwcmludFxuICB9XG59XG5cbi8vIEdpdmUgRnJhbWUgYW4gZWFzeSBkZXNjcmlwdG9yXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUsICdDb25zdHJ1Y3RvcicpXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUuY29uc3RydWN0b3IsICdGcmFtZScpXG5cbi8vIEV4cG9ydCBGcmFtZSBnbG9iYWxseVxuZXhwb3J0ZXIoJ0ZyYW1lJywgRnJhbWUpXG5leHBvcnQgZGVmYXVsdCBGcmFtZVxuIl0sIm5hbWVzIjpbImhlbHBlcnMuYXNzaWduT2JqZWN0IiwiaGVscGVycy5zZXREZXNjcmlwdG9yIiwiaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZSJdLCJtYXBwaW5ncyI6Ijs7O0VBRUEsU0FBUyxHQUFHLEdBQUc7RUFDZjtFQUNBLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QjtFQUNBLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUN0QyxFQUFDOztFQUVELEdBQUcsQ0FBQyxJQUFJLEdBQUcsV0FBVztFQUN0QjtFQUNBLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNyQyxDQUFDOztFQ2ZEO0VBQ0E7RUFDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO0VBQzdCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxPQUFPLE1B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
