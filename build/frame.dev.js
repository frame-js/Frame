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

  log.debug = function() {
    console.log.apply(this, arguments);
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
    for (const propertyName of Object.getOwnPropertyNames(source)) {
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
    const target = {};

    // If no target exist, stub them so we don't run into issues later.
    if (!source)
      source = {};

    // Create stubs for Array of keys. Example: ['init', 'in', etc]
    for (const key of keys) {
      target[key] = [];
    }

    // Loop through source's keys
    for (const key of Object.keys(source)) {
      target[key] = [];

      // We only support objects for now. Example { init: { 'someKey': 'someDescription' }}
      if (typeof source[key] !== 'object' || Array.isArray(source[key]))
        continue

      // TODO: Support arrays for type checking
      // Example: { init: 'someKey': ['some description', 'string'] }

      const propIndex = [];
      for (const prop of Object.keys(source[key])) {
        propIndex.push({ name: prop, description: source[key][prop] });
      }

      target[key] = propIndex;
    }

    return target
  }

  function destructure(target, props) {
    const sourceProps = (!props) ? [] : Array.from(props);

    if (!target)
      return sourceProps

    const targetProps = {};
    let propIndex = 0;

    // Loop through our target keys, and assign the object's key to the value of the props input.
    for (const targetProp of target) {
      targetProps[targetProp.name] = sourceProps[propIndex];
      propIndex++;
    }

    // If we don't have a valid target; return props array instead. Exemple: ['prop1', 'prop2']
    if (propIndex === 0)
      return props

    // Example: { someKey: someValue, someOtherKey: someOtherValue }
    return targetProps
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

    log.debug('Processing flow for ' + this.name);
    log.debug();
    this.Frame.processingFlow = true;

    // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
    this.Frame.pipes.unshift({ direction: 'to', target: this });

    // Break out event pipes and flow pipes into separate flows.
    let i = 1; // Start at 1, since our worker blueprint instance should be 0
    for (const pipe of this.Frame.pipes) {
      const blueprint = pipe.target;

      if (pipe.direction === 'from') {
        if (typeof blueprint.on !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')
        else {
          // .from(Events) start the flow at index 0
          pipe.context = createContext(this, pipe.target, 0);
          this.Frame.events.push(pipe);
        }
      } else if (pipe.direction === 'to') {
        pipe.context = createContext(this, pipe.target, i);
        this.Frame.flow.push(pipe);
        i++;
      }
    }

    startFlow.call(this);
  }

  function createContext(worker, blueprint, index) {
    return {
      name: blueprint.name,
      out: blueprint.out.bind(worker, index),
      error: blueprint.error.bind(worker, index),
    }
  }

  function flowsReady() {
    // if blueprint has not been initialized yet (i.e. constructor not used.)
    if (!this.Frame.initialized) {
      initBlueprint.call(this, processFlow);
      return false
    }

    // Loop through all blueprints in flow to make sure they have been loaded and initialized.
    let flowsReady = true;
    for (const pipe of this.Frame.pipes) {
      const target = pipe.target;

      // Not a blueprint, either a function or primitive
      if (target.stub)
        continue

      if (!target.Frame.loaded) {
        flowsReady = false;
        continue
      }

      if (!target.Frame.initialized) {
        initBlueprint.call(target, processFlow.bind(this));
        flowsReady = false;
        continue
      }
    }

    return flowsReady
  }

  function startFlow() {
    log.debug('Starting flow for ' + this.name);

    for (const event of this.Frame.events) {
      const blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);

      // If not already processing flow.
      if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
        log.debug(this.name + ' is not starting ' + blueprint.name + ', waiting for it to finish');
      else if (!blueprint.Frame.processingFlow)
        blueprint.on.call(event.context, props);
    }
  }

  function initBlueprint(callback) {
    const blueprint = this;

    try {
      let props = blueprint.Frame.props ? blueprint.Frame.props : {};

      // If Blueprint foregoes the initializer, stub it.
      if (!blueprint.init)
        blueprint.init = function(_, callback) {
          callback();
        };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log.error('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed
        log.debug('Blueprint ' + blueprint.name + ' intialized');

        blueprint.Frame.props = {};
        blueprint.Frame.initialized = true;
        callback && callback.call(blueprint);
      });

    } catch (err) {
      throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
    }
  }

  // Blueprint Methods
  const BlueprintMethods = {
    to: function(target) {
      return addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
    },

    from: function(target) {
      return addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
    },

    out: function(index, data) {
      log.debug(this.name + '.out:', data, arguments);
      queue(nextPipe, this, [index, null, data]);
    },

    error: function(index, err) {
      log.error(this.name + '.error:', data, arguments);
      queue(nextPipe, this, [index, err]);
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

  // Flow Method helpers
  function BlueprintStub(target) {
    const blueprint = {};
    assignObject(blueprint, BlueprintMethods);

    blueprint.stub = true;
    blueprint.Frame = {
      parents: [],
      describe: [],
    };

    if (typeof target === 'function') {
      setDescriptor(blueprint, 'Function');
      blueprint.in = target;
      blueprint.on = target;
    } else {
      setDescriptor(blueprint, 'Primitive');
      blueprint.in = function primitiveWrapper() {
        log.debug(this.name + '.in:', target);
        this.out(target);
      };
      blueprint.on = function primitiveWrapper() {
        log.debug(this.name + '.on:', target);
        this.out(target);
      };
    }

    return blueprint
  }

  function debounce(func, wait, blueprint, args) {
    const name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.apply(blueprint, args);
    }, wait);
  }

  function queue(func, blueprint, args) {
    if (!blueprint.Frame.queue)
      blueprint.Frame.queue = [];

    blueprint.Frame.queue.push(setTimeout(function() {
      // TODO: Cleanup queue
      func.apply(blueprint, args);
    }, 1));
  }

  function factory(fn) {
    return function() {
      return fn.apply(this, arguments)
    }
  }

  // Pipe control
  function addPipe(direction, target, params) {
    if (!this)
      throw new Error('Blueprint method called without instance, did you assign the method to a variable?')

    if (!this.Frame || !this.Frame.pipes)
      throw new Error('Not working with a valid Blueprint object')

    if (!target)
      throw new Error(this.Frame.name + '.' + direction + '() was called with improper parameters')

    if (typeof target === 'function' && typeof target.to !== 'function') {
      target = BlueprintStub(target);
    } else if (typeof target !== 'function') {
      target = BlueprintStub(target);
    }

    // Ensure we're working on a new instance of worker blueprint
    let blueprint = this;
    if (!blueprint.Frame.instance) {
      blueprint = blueprint();
      blueprint.Frame.instance = true;
    }

    log.debug(blueprint.name + '.' + direction + '(): ' + target.name);
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    // Used when target blueprint is part of another flow
    if (target && target.Frame)
      target.Frame.parents.push({ target: blueprint }); // TODO: Check if worker blueprint is already added.

    debounce(processFlow, 1, blueprint);
    return blueprint
  }

  function nextPipe(index, err, data) {
    log.debug('next:', index);
    if (err) {
      log.error('TODO: handle error:', err);
      this.Frame.processingFlow = false;
      return
    }

    const flow = this.Frame.flow;
    const next = flow[index];

    // If we're at the end of the flow
    if (!next || !next.target) {
      this.Frame.processingFlow = false;

      if (this.Frame.isPromised) {
        this.Frame.promise.resolve(data);
        this.Frame.isPromised = false;
      }

      // If blueprint is part of another flow
      const parents = this.Frame.parents;
      if (parents.length > 0) {
        for (const parent of parents) {
          let blueprint = parent.target;
          log.debug('Calling parent ' + blueprint.name, 'for', this.name);
          queue(nextPipe, blueprint, [0, null, data]);
        }
      }

      return log.debug('End of flow for', this.name, 'at', index)
    }

    callNext(next, data);
  }

  function callNext(next, data) {
    const blueprint = next.target;
    const props = destructure(blueprint.Frame.describe.in, next.params);
    const context = next.context;
    const retValue = blueprint.in.call(context, data, props, new factory(pipeCallback).bind(context));
    const retType = typeof retValue;

    // Blueprint.in does not return anything
    if (retType === 'undefined')
      return

    if (retType === 'object' && retValue instanceof Promise) {
      // Handle promises
      retValue.then(context.out).catch(context.error);
    } else if (retType === 'object' && retValue instanceof Error) {
      // Handle errors
      context.error(retValue);
    } else {
      // Handle regular primitives and objects
      context.out(retValue);
    }
  }

  function pipeCallback(err, data) {
    if (err)
      return this.error(err)

    return this.out(data)
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

    instance: false,
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
    const schema = Object.create(schemaObj);
    Object.assign(schema, schemaObj);

    // Loop through Schema object keys
    for (const key of Object.keys(schema)) {
      // Create a schema object with types
      if (typeof schema[key] === 'function')
        schema[key] = { required: true, type: typeof schema[key]() };
      else if (typeof schema[key] === 'object' && Array.isArray(schema[key])) {
        const schemaArr = schema[key];
        schema[key] = { required: false, type: 'optional', types: [] };
        for (const schemaType of schemaArr) {
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
      const proxyObj = {};
      const obj = objToValidate;

      for (const key of Object.getOwnPropertyNames(objToValidate)) {
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
        for (const key of Object.getOwnPropertyNames(schema)) {
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

        const file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '');
        const filePath = 'blueprints/' + file;
        return filePath
      },

      browser: {
        load: function(fileName, callback) {
          const filePath = this.normalizeFilePath(fileName);
          log.debug('[http loader] Loading file: ' + filePath);

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

        log.debug('[file loader] Loading file: ' + fileName);

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
    for (const callback of module.callbacks) {
      callback(module.module);
    }

    module.callbacks = [];
  }

  const imports = function(name, opts, callback) {
    try {
      const fileInfo = resolveFileInfo(name);
      const fileName = fileInfo.name;
      const protocol = fileInfo.protocol;

      log.debug('loading module:', fileName);

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
          log.error('Error: ', err, fileName);
        else {
          log.debug('Loaded Blueprint module: ', fileName);

          if (!exportFile || typeof exportFile !== 'object')
            throw new Error('Invalid Blueprint file, Blueprint is expected to be an object or class')

          if (typeof exportFile.name !== 'string')
            throw new Error('Invalid Blueprint file, Blueprint missing a name')

          const module = modules[fileName];
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

        log.debug('Blueprint loaded:', blueprintFile.name);

        if (typeof blueprintFile !== 'object')
          throw new Error('Blueprint is expected to be an object or class')

        // Update faux blueprint stub with real module
        assignObject(blueprint, blueprintFile);

        // Update blueprint name
        setDescriptor(blueprint, blueprintFile.name, false);
        blueprint.Frame.name = blueprintFile.name;

        // Apply a schema to blueprint
        blueprint = BlueprintSchema(blueprint);

        // Validate Blueprint input with optional property destructuring (using describe object)
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
    const blueprint = new BlueprintConstructor(name);
    setDescriptor(blueprint, 'Blueprint', true);

    // Blueprint methods
    assignObject(blueprint, BlueprintMethods);

    // Create hidden blueprint.Frame property to keep state
    const blueprintBase = Object.create(BlueprintBase);
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

      const blueprint = new Frame(name);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuZGV2LmpzIiwic291cmNlcyI6WyIuLi9saWIvbG9nZ2VyLmpzIiwiLi4vbGliL2V4cG9ydHMuanMiLCIuLi9saWIvaGVscGVycy5qcyIsIi4uL2xpYi9mbG93LmpzIiwiLi4vbGliL21ldGhvZHMuanMiLCIuLi9saWIvQmx1ZXByaW50QmFzZS5qcyIsIi4uL2xpYi9PYmplY3RNb2RlbC5qcyIsIi4uL2xpYi9zY2hlbWEuanMiLCIuLi9saWIvTW9kdWxlTG9hZGVyLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZS5qcyIsIi4uL2xpYi9sb2FkZXIuanMiLCIuLi9saWIvRnJhbWUuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy53YXJuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUud2Fybi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5kZWJ1ZyA9IGZ1bmN0aW9uKCkge1xuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmV4cG9ydCBkZWZhdWx0IGxvZ1xuIiwiLy8gVW5pdmVyc2FsIGV4cG9ydCBmdW5jdGlvbiBkZXBlbmRpbmcgb24gZW52aXJvbm1lbnQuXG4vLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGlzIHByb3ZlcyB0byBiZSBpbmVmZmVjdGl2ZSwgZGlmZmVyZW50IHRhcmdldHMgZm9yIHJvbGx1cCBjb3VsZCBiZSBjb25zaWRlcmVkLlxuZnVuY3Rpb24gZXhwb3J0ZXIobmFtZSwgb2JqKSB7XG4gIC8vIE5vZGUuanMgJiBub2RlLWxpa2UgZW52aXJvbm1lbnRzIChleHBvcnQgYXMgbW9kdWxlKVxuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0JylcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG9ialxuXG4gIC8vIEdsb2JhbCBleHBvcnQgKGFsc28gYXBwbGllZCB0byBOb2RlICsgbm9kZS1saWtlIGVudmlyb25tZW50cylcbiAgaWYgKHR5cGVvZiBnbG9iYWwgPT09ICdvYmplY3QnKVxuICAgIGdsb2JhbFtuYW1lXSA9IG9ialxuXG4gIC8vIFVNRFxuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gICAgZGVmaW5lKFsnZXhwb3J0cyddLCBmdW5jdGlvbihleHApIHtcbiAgICAgIGV4cFtuYW1lXSA9IG9ialxuICAgIH0pXG5cbiAgLy8gQnJvd3NlcnMgYW5kIGJyb3dzZXItbGlrZSBlbnZpcm9ubWVudHMgKEVsZWN0cm9uLCBIeWJyaWQgd2ViIGFwcHMsIGV0YylcbiAgZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgd2luZG93W25hbWVdID0gb2JqXG59XG5cbmV4cG9ydCBkZWZhdWx0IGV4cG9ydGVyXG4iLCIndXNlIHN0cmljdCdcblxuLy8gT2JqZWN0IGhlbHBlciBmdW5jdGlvbnNcbmZ1bmN0aW9uIGFzc2lnbk9iamVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzb3VyY2UpKSB7XG4gICAgaWYgKHByb3BlcnR5TmFtZSA9PT0gJ25hbWUnKVxuICAgICAgY29udGludWVcblxuICAgIGlmICh0eXBlb2Ygc291cmNlW3Byb3BlcnR5TmFtZV0gPT09ICdvYmplY3QnKVxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc291cmNlW3Byb3BlcnR5TmFtZV0pKVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IFtdXG4gICAgICBlbHNlXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gT2JqZWN0LmNyZWF0ZShzb3VyY2VbcHJvcGVydHlOYW1lXSwgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMoc291cmNlW3Byb3BlcnR5TmFtZV0pKVxuICAgIGVsc2VcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShcbiAgICAgICAgdGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWUsXG4gICAgICAgIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Ioc291cmNlLCBwcm9wZXJ0eU5hbWUpXG4gICAgICApXG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIHNldERlc2NyaXB0b3IodGFyZ2V0LCB2YWx1ZSwgY29uZmlndXJhYmxlKSB7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICd0b1N0cmluZycsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHZhbHVlOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiAodmFsdWUpID8gJ1tGcmFtZTogJyArIHZhbHVlICsgJ10nIDogJ1tGcmFtZTogQ29uc3RydWN0b3JdJ1xuICAgIH0sXG4gIH0pXG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ25hbWUnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogKGNvbmZpZ3VyYWJsZSkgPyB0cnVlIDogZmFsc2UsXG4gICAgdmFsdWU6IHZhbHVlLFxuICB9KVxufVxuXG4vLyBEZXN0cnVjdHVyZSB1c2VyIGlucHV0IGZvciBwYXJhbWV0ZXIgZGVzdHJ1Y3R1cmluZyBpbnRvICdwcm9wcycgb2JqZWN0LlxuZnVuY3Rpb24gY3JlYXRlRGVzdHJ1Y3R1cmUoc291cmNlLCBrZXlzKSB7XG4gIGNvbnN0IHRhcmdldCA9IHt9XG5cbiAgLy8gSWYgbm8gdGFyZ2V0IGV4aXN0LCBzdHViIHRoZW0gc28gd2UgZG9uJ3QgcnVuIGludG8gaXNzdWVzIGxhdGVyLlxuICBpZiAoIXNvdXJjZSlcbiAgICBzb3VyY2UgPSB7fVxuXG4gIC8vIENyZWF0ZSBzdHVicyBmb3IgQXJyYXkgb2Yga2V5cy4gRXhhbXBsZTogWydpbml0JywgJ2luJywgZXRjXVxuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIHNvdXJjZSdzIGtleXNcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc291cmNlKSkge1xuICAgIHRhcmdldFtrZXldID0gW11cblxuICAgIC8vIFdlIG9ubHkgc3VwcG9ydCBvYmplY3RzIGZvciBub3cuIEV4YW1wbGUgeyBpbml0OiB7ICdzb21lS2V5JzogJ3NvbWVEZXNjcmlwdGlvbicgfX1cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtrZXldICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHNvdXJjZVtrZXldKSlcbiAgICAgIGNvbnRpbnVlXG5cbiAgICAvLyBUT0RPOiBTdXBwb3J0IGFycmF5cyBmb3IgdHlwZSBjaGVja2luZ1xuICAgIC8vIEV4YW1wbGU6IHsgaW5pdDogJ3NvbWVLZXknOiBbJ3NvbWUgZGVzY3JpcHRpb24nLCAnc3RyaW5nJ10gfVxuXG4gICAgY29uc3QgcHJvcEluZGV4ID0gW11cbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgT2JqZWN0LmtleXMoc291cmNlW2tleV0pKSB7XG4gICAgICBwcm9wSW5kZXgucHVzaCh7IG5hbWU6IHByb3AsIGRlc2NyaXB0aW9uOiBzb3VyY2Vba2V5XVtwcm9wXSB9KVxuICAgIH1cblxuICAgIHRhcmdldFtrZXldID0gcHJvcEluZGV4XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmZ1bmN0aW9uIGRlc3RydWN0dXJlKHRhcmdldCwgcHJvcHMpIHtcbiAgY29uc3Qgc291cmNlUHJvcHMgPSAoIXByb3BzKSA/IFtdIDogQXJyYXkuZnJvbShwcm9wcylcblxuICBpZiAoIXRhcmdldClcbiAgICByZXR1cm4gc291cmNlUHJvcHNcblxuICBjb25zdCB0YXJnZXRQcm9wcyA9IHt9XG4gIGxldCBwcm9wSW5kZXggPSAwXG5cbiAgLy8gTG9vcCB0aHJvdWdoIG91ciB0YXJnZXQga2V5cywgYW5kIGFzc2lnbiB0aGUgb2JqZWN0J3Mga2V5IHRvIHRoZSB2YWx1ZSBvZiB0aGUgcHJvcHMgaW5wdXQuXG4gIGZvciAoY29uc3QgdGFyZ2V0UHJvcCBvZiB0YXJnZXQpIHtcbiAgICB0YXJnZXRQcm9wc1t0YXJnZXRQcm9wLm5hbWVdID0gc291cmNlUHJvcHNbcHJvcEluZGV4XVxuICAgIHByb3BJbmRleCsrXG4gIH1cblxuICAvLyBJZiB3ZSBkb24ndCBoYXZlIGEgdmFsaWQgdGFyZ2V0OyByZXR1cm4gcHJvcHMgYXJyYXkgaW5zdGVhZC4gRXhlbXBsZTogWydwcm9wMScsICdwcm9wMiddXG4gIGlmIChwcm9wSW5kZXggPT09IDApXG4gICAgcmV0dXJuIHByb3BzXG5cbiAgLy8gRXhhbXBsZTogeyBzb21lS2V5OiBzb21lVmFsdWUsIHNvbWVPdGhlcktleTogc29tZU90aGVyVmFsdWUgfVxuICByZXR1cm4gdGFyZ2V0UHJvcHNcbn1cblxuZXhwb3J0IHtcbiAgYXNzaWduT2JqZWN0LFxuICBzZXREZXNjcmlwdG9yLFxuICBjcmVhdGVEZXN0cnVjdHVyZSxcbiAgZGVzdHJ1Y3R1cmVcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IHsgZGVzdHJ1Y3R1cmUgfSBmcm9tICcuL2hlbHBlcnMnXG5cbmZ1bmN0aW9uIHByb2Nlc3NGbG93KCkge1xuICAvLyBBbHJlYWR5IHByb2Nlc3NpbmcgdGhpcyBCbHVlcHJpbnQncyBmbG93LlxuICBpZiAodGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICByZXR1cm5cblxuICAvLyBJZiBubyBwaXBlcyBmb3IgZmxvdywgdGhlbiBub3RoaW5nIHRvIGRvLlxuICBpZiAodGhpcy5GcmFtZS5waXBlcy5sZW5ndGggPCAxKVxuICAgIHJldHVyblxuXG4gIC8vIENoZWNrIHRoYXQgYWxsIGJsdWVwcmludHMgYXJlIHJlYWR5XG4gIGlmICghZmxvd3NSZWFkeS5jYWxsKHRoaXMpKVxuICAgIHJldHVyblxuXG4gIGxvZy5kZWJ1ZygnUHJvY2Vzc2luZyBmbG93IGZvciAnICsgdGhpcy5uYW1lKVxuICBsb2cuZGVidWcoKVxuICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gdHJ1ZVxuXG4gIC8vIFB1dCB0aGlzIGJsdWVwcmludCBhdCB0aGUgYmVnaW5uaW5nIG9mIHRoZSBmbG93LCB0aGF0IHdheSBhbnkgLmZyb20gZXZlbnRzIHRyaWdnZXIgdGhlIHRvcCBsZXZlbCBmaXJzdC5cbiAgdGhpcy5GcmFtZS5waXBlcy51bnNoaWZ0KHsgZGlyZWN0aW9uOiAndG8nLCB0YXJnZXQ6IHRoaXMgfSlcblxuICAvLyBCcmVhayBvdXQgZXZlbnQgcGlwZXMgYW5kIGZsb3cgcGlwZXMgaW50byBzZXBhcmF0ZSBmbG93cy5cbiAgbGV0IGkgPSAxIC8vIFN0YXJ0IGF0IDEsIHNpbmNlIG91ciB3b3JrZXIgYmx1ZXByaW50IGluc3RhbmNlIHNob3VsZCBiZSAwXG4gIGZvciAoY29uc3QgcGlwZSBvZiB0aGlzLkZyYW1lLnBpcGVzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gcGlwZS50YXJnZXRcblxuICAgIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ2Zyb20nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5vbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50cy4nKVxuICAgICAgZWxzZSB7XG4gICAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgICBwaXBlLmNvbnRleHQgPSBjcmVhdGVDb250ZXh0KHRoaXMsIHBpcGUudGFyZ2V0LCAwKVxuICAgICAgICB0aGlzLkZyYW1lLmV2ZW50cy5wdXNoKHBpcGUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwaXBlLmRpcmVjdGlvbiA9PT0gJ3RvJykge1xuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDb250ZXh0KHdvcmtlciwgYmx1ZXByaW50LCBpbmRleCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGJsdWVwcmludC5uYW1lLFxuICAgIG91dDogYmx1ZXByaW50Lm91dC5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICAgIGVycm9yOiBibHVlcHJpbnQuZXJyb3IuYmluZCh3b3JrZXIsIGluZGV4KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICBsZXQgZmxvd3NSZWFkeSA9IHRydWVcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuXG4gICAgLy8gTm90IGEgYmx1ZXByaW50LCBlaXRoZXIgYSBmdW5jdGlvbiBvciBwcmltaXRpdmVcbiAgICBpZiAodGFyZ2V0LnN0dWIpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUubG9hZGVkKSB7XG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZsb3dzUmVhZHlcbn1cblxuZnVuY3Rpb24gc3RhcnRGbG93KCkge1xuICBsb2cuZGVidWcoJ1N0YXJ0aW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG5cbiAgZm9yIChjb25zdCBldmVudCBvZiB0aGlzLkZyYW1lLmV2ZW50cykge1xuICAgIGNvbnN0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG5cbiAgICAvLyBJZiBub3QgYWxyZWFkeSBwcm9jZXNzaW5nIGZsb3cuXG4gICAgaWYgKGJsdWVwcmludC5GcmFtZS5waXBlcyAmJiBibHVlcHJpbnQuRnJhbWUucGlwZXMubGVuZ3RoID4gMClcbiAgICAgIGxvZy5kZWJ1Zyh0aGlzLm5hbWUgKyAnIGlzIG5vdCBzdGFydGluZyAnICsgYmx1ZXByaW50Lm5hbWUgKyAnLCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2gnKVxuICAgIGVsc2UgaWYgKCFibHVlcHJpbnQuRnJhbWUucHJvY2Vzc2luZ0Zsb3cpXG4gICAgICBibHVlcHJpbnQub24uY2FsbChldmVudC5jb250ZXh0LCBwcm9wcylcbiAgfVxufVxuXG5mdW5jdGlvbiBpbml0Qmx1ZXByaW50KGNhbGxiYWNrKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IHRoaXNcblxuICB0cnkge1xuICAgIGxldCBwcm9wcyA9IGJsdWVwcmludC5GcmFtZS5wcm9wcyA/IGJsdWVwcmludC5GcmFtZS5wcm9wcyA6IHt9XG5cbiAgICAvLyBJZiBCbHVlcHJpbnQgZm9yZWdvZXMgdGhlIGluaXRpYWxpemVyLCBzdHViIGl0LlxuICAgIGlmICghYmx1ZXByaW50LmluaXQpXG4gICAgICBibHVlcHJpbnQuaW5pdCA9IGZ1bmN0aW9uKF8sIGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludClcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgeyBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCB7IGRlc3RydWN0dXJlLCBhc3NpZ25PYmplY3QsIHNldERlc2NyaXB0b3IgfSBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgeyBwcm9jZXNzRmxvdyB9IGZyb20gJy4vZmxvdydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICd0bycsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIGZyb206IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBvdXQ6IGZ1bmN0aW9uKGluZGV4LCBkYXRhKSB7XG4gICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcub3V0OicsIGRhdGEsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGxvZy5lcnJvcih0aGlzLm5hbWUgKyAnLmVycm9yOicsIGRhdGEsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBlcnJdKVxuICB9LFxuXG4gIGdldCB2YWx1ZSgpIHtcbiAgICAvLyBCYWlsIGlmIHdlJ3JlIG5vdCByZWFkeS4gKFVzZWQgdG8gZ2V0IG91dCBvZiBPYmplY3RNb2RlbCBhbmQgYXNzaWduT2JqZWN0IGxpbWJvKVxuICAgIGlmICghdGhpcy5GcmFtZSlcbiAgICAgIHJldHVybiAnJ1xuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2VGb3JWYWx1ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgYmx1ZXByaW50LkZyYW1lLmlzUHJvbWlzZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvbWlzZSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QgfVxuICAgIH0pXG4gICAgcmV0dXJuIHByb21pc2VGb3JWYWx1ZVxuICB9LFxufVxuXG4vLyBGbG93IE1ldGhvZCBoZWxwZXJzXG5mdW5jdGlvbiBCbHVlcHJpbnRTdHViKHRhcmdldCkge1xuICBjb25zdCBibHVlcHJpbnQgPSB7fVxuICBhc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIGJsdWVwcmludC5zdHViID0gdHJ1ZVxuICBibHVlcHJpbnQuRnJhbWUgPSB7XG4gICAgcGFyZW50czogW10sXG4gICAgZGVzY3JpYmU6IFtdLFxuICB9XG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBzZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0Z1bmN0aW9uJylcbiAgICBibHVlcHJpbnQuaW4gPSB0YXJnZXRcbiAgICBibHVlcHJpbnQub24gPSB0YXJnZXRcbiAgfSBlbHNlIHtcbiAgICBzZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ1ByaW1pdGl2ZScpXG4gICAgYmx1ZXByaW50LmluID0gZnVuY3Rpb24gcHJpbWl0aXZlV3JhcHBlcigpIHtcbiAgICAgIGxvZy5kZWJ1Zyh0aGlzLm5hbWUgKyAnLmluOicsIHRhcmdldClcbiAgICAgIHRoaXMub3V0KHRhcmdldClcbiAgICB9XG4gICAgYmx1ZXByaW50Lm9uID0gZnVuY3Rpb24gcHJpbWl0aXZlV3JhcHBlcigpIHtcbiAgICAgIGxvZy5kZWJ1Zyh0aGlzLm5hbWUgKyAnLm9uOicsIHRhcmdldClcbiAgICAgIHRoaXMub3V0KHRhcmdldClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZ1bmMsIHdhaXQsIGJsdWVwcmludCwgYXJncykge1xuICBjb25zdCBuYW1lID0gZnVuYy5uYW1lXG4gIGNsZWFyVGltZW91dChibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0pXG4gIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCB3YWl0KVxufVxuXG5mdW5jdGlvbiBxdWV1ZShmdW5jLCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgaWYgKCFibHVlcHJpbnQuRnJhbWUucXVldWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlID0gW11cblxuICBibHVlcHJpbnQuRnJhbWUucXVldWUucHVzaChzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIC8vIFRPRE86IENsZWFudXAgcXVldWVcbiAgICBmdW5jLmFwcGx5KGJsdWVwcmludCwgYXJncylcbiAgfSwgMSkpXG59XG5cbmZ1bmN0aW9uIGZhY3RvcnkoZm4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cbn1cblxuLy8gUGlwZSBjb250cm9sXG5mdW5jdGlvbiBhZGRQaXBlKGRpcmVjdGlvbiwgdGFyZ2V0LCBwYXJhbXMpIHtcbiAgaWYgKCF0aGlzKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG1ldGhvZCBjYWxsZWQgd2l0aG91dCBpbnN0YW5jZSwgZGlkIHlvdSBhc3NpZ24gdGhlIG1ldGhvZCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiB0YXJnZXQudG8gIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH1cblxuICAvLyBFbnN1cmUgd2UncmUgd29ya2luZyBvbiBhIG5ldyBpbnN0YW5jZSBvZiB3b3JrZXIgYmx1ZXByaW50XG4gIGxldCBibHVlcHJpbnQgPSB0aGlzXG4gIGlmICghYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlKSB7XG4gICAgYmx1ZXByaW50ID0gYmx1ZXByaW50KClcbiAgICBibHVlcHJpbnQuRnJhbWUuaW5zdGFuY2UgPSB0cnVlXG4gIH1cblxuICBsb2cuZGVidWcoYmx1ZXByaW50Lm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCk6ICcgKyB0YXJnZXQubmFtZSlcbiAgYmx1ZXByaW50LkZyYW1lLnBpcGVzLnB1c2goeyBkaXJlY3Rpb246IGRpcmVjdGlvbiwgdGFyZ2V0OiB0YXJnZXQsIHBhcmFtczogcGFyYW1zIH0pXG5cbiAgLy8gVXNlZCB3aGVuIHRhcmdldCBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgaWYgKHRhcmdldCAmJiB0YXJnZXQuRnJhbWUpXG4gICAgdGFyZ2V0LkZyYW1lLnBhcmVudHMucHVzaCh7IHRhcmdldDogYmx1ZXByaW50IH0pIC8vIFRPRE86IENoZWNrIGlmIHdvcmtlciBibHVlcHJpbnQgaXMgYWxyZWFkeSBhZGRlZC5cblxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIG5leHRQaXBlKGluZGV4LCBlcnIsIGRhdGEpIHtcbiAgbG9nLmRlYnVnKCduZXh0OicsIGluZGV4KVxuICBpZiAoZXJyKSB7XG4gICAgbG9nLmVycm9yKCdUT0RPOiBoYW5kbGUgZXJyb3I6JywgZXJyKVxuICAgIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSBmYWxzZVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgZmxvdyA9IHRoaXMuRnJhbWUuZmxvd1xuICBjb25zdCBuZXh0ID0gZmxvd1tpbmRleF1cblxuICAvLyBJZiB3ZSdyZSBhdCB0aGUgZW5kIG9mIHRoZSBmbG93XG4gIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpIHtcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcblxuICAgIGlmICh0aGlzLkZyYW1lLmlzUHJvbWlzZWQpIHtcbiAgICAgIHRoaXMuRnJhbWUucHJvbWlzZS5yZXNvbHZlKGRhdGEpXG4gICAgICB0aGlzLkZyYW1lLmlzUHJvbWlzZWQgPSBmYWxzZVxuICAgIH1cblxuICAgIC8vIElmIGJsdWVwcmludCBpcyBwYXJ0IG9mIGFub3RoZXIgZmxvd1xuICAgIGNvbnN0IHBhcmVudHMgPSB0aGlzLkZyYW1lLnBhcmVudHNcbiAgICBpZiAocGFyZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IHBhcmVudCBvZiBwYXJlbnRzKSB7XG4gICAgICAgIGxldCBibHVlcHJpbnQgPSBwYXJlbnQudGFyZ2V0XG4gICAgICAgIGxvZy5kZWJ1ZygnQ2FsbGluZyBwYXJlbnQgJyArIGJsdWVwcmludC5uYW1lLCAnZm9yJywgdGhpcy5uYW1lKVxuICAgICAgICBxdWV1ZShuZXh0UGlwZSwgYmx1ZXByaW50LCBbMCwgbnVsbCwgZGF0YV0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGxvZy5kZWJ1ZygnRW5kIG9mIGZsb3cgZm9yJywgdGhpcy5uYW1lLCAnYXQnLCBpbmRleClcbiAgfVxuXG4gIGNhbGxOZXh0KG5leHQsIGRhdGEpXG59XG5cbmZ1bmN0aW9uIGNhbGxOZXh0KG5leHQsIGRhdGEpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gbmV4dC50YXJnZXRcbiAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW4sIG5leHQucGFyYW1zKVxuICBjb25zdCBjb250ZXh0ID0gbmV4dC5jb250ZXh0XG4gIGNvbnN0IHJldFZhbHVlID0gYmx1ZXByaW50LmluLmNhbGwoY29udGV4dCwgZGF0YSwgcHJvcHMsIG5ldyBmYWN0b3J5KHBpcGVDYWxsYmFjaykuYmluZChjb250ZXh0KSlcbiAgY29uc3QgcmV0VHlwZSA9IHR5cGVvZiByZXRWYWx1ZVxuXG4gIC8vIEJsdWVwcmludC5pbiBkb2VzIG5vdCByZXR1cm4gYW55dGhpbmdcbiAgaWYgKHJldFR5cGUgPT09ICd1bmRlZmluZWQnKVxuICAgIHJldHVyblxuXG4gIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAvLyBIYW5kbGUgcHJvbWlzZXNcbiAgICByZXRWYWx1ZS50aGVuKGNvbnRleHQub3V0KS5jYXRjaChjb250ZXh0LmVycm9yKVxuICB9IGVsc2UgaWYgKHJldFR5cGUgPT09ICdvYmplY3QnICYmIHJldFZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAvLyBIYW5kbGUgZXJyb3JzXG4gICAgY29udGV4dC5lcnJvcihyZXRWYWx1ZSlcbiAgfSBlbHNlIHtcbiAgICAvLyBIYW5kbGUgcmVndWxhciBwcmltaXRpdmVzIGFuZCBvYmplY3RzXG4gICAgY29udGV4dC5vdXQocmV0VmFsdWUpXG4gIH1cbn1cblxuZnVuY3Rpb24gcGlwZUNhbGxiYWNrKGVyciwgZGF0YSkge1xuICBpZiAoZXJyKVxuICAgIHJldHVybiB0aGlzLmVycm9yKGVycilcblxuICByZXR1cm4gdGhpcy5vdXQoZGF0YSlcbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50TWV0aG9kc1xuZXhwb3J0IHsgQmx1ZXByaW50TWV0aG9kcywgZGVib3VuY2UsIHByb2Nlc3NGbG93IH1cbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBJbnRlcm5hbCBGcmFtZSBwcm9wc1xuY29uc3QgQmx1ZXByaW50QmFzZSA9IHtcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sXG4gIHByb3BzOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgZGVib3VuY2U6IHt9LFxuICBwYXJlbnRzOiBbXSxcblxuICBpbnN0YW5jZTogZmFsc2UsXG4gIHBpcGVzOiBbXSxcbiAgZXZlbnRzOiBbXSxcbiAgZmxvdzogW10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LmNyZWF0ZShzY2hlbWFPYmopXG4gIE9iamVjdC5hc3NpZ24oc2NoZW1hLCBzY2hlbWFPYmopXG5cbiAgLy8gTG9vcCB0aHJvdWdoIFNjaGVtYSBvYmplY3Qga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGNvbnN0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChjb25zdCBzY2hlbWFUeXBlIG9mIHNjaGVtYUFycikge1xuICAgICAgICBpZiAodHlwZW9mIHNjaGVtYVR5cGUgPT09ICdmdW5jdGlvbicpXG4gICAgICAgICAgc2NoZW1hW2tleV0udHlwZXMucHVzaCh0eXBlb2Ygc2NoZW1hVHlwZSgpKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHNjaGVtYVtrZXldLnR5cGUsIGV4cGVjdHM6IHNjaGVtYVtrZXldLmV4cGVjdHMgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSB9XG4gICAgfVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIHByb3BzXG4gIGZ1bmN0aW9uIGlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkge1xuICAgIC8vIFRPRE86IE1ha2UgbW9yZSBmbGV4aWJsZSBieSBkZWZpbmluZyBudWxsIGFuZCB1bmRlZmluZWQgdHlwZXMuXG4gICAgLy8gTm8gc2NoZW1hIGRlZmluZWQgZm9yIGtleVxuICAgIGlmICghc2NoZW1hW2tleV0pXG4gICAgICByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHR5cGVvZiB2YWx1ZSA9PT0gc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKCFzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICBpZiAodmFsdWUgJiYgIXNjaGVtYVtrZXldLnR5cGVzLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gICAgICAgIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XS5leHBlY3RzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWFba2V5XS5leHBlY3RzKHZhbHVlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIChvbmNlIFNjaGVtYSBjb25zdHJ1Y3RvciBpcyBjYWxsZWQpXG4gIHJldHVybiBmdW5jdGlvbiB2YWxpZGF0ZVNjaGVtYShvYmpUb1ZhbGlkYXRlKSB7XG4gICAgY29uc3QgcHJveHlPYmogPSB7fVxuICAgIGNvbnN0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9ialRvVmFsaWRhdGUpKSB7XG4gICAgICBjb25zdCBwcm9wRGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqVG9WYWxpZGF0ZSwga2V5KVxuXG4gICAgICAvLyBQcm9wZXJ0eSBhbHJlYWR5IHByb3RlY3RlZFxuICAgICAgaWYgKCFwcm9wRGVzY3JpcHRvci53cml0YWJsZSB8fCAhcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIFNjaGVtYSBkb2VzIG5vdCBleGlzdCBmb3IgcHJvcCwgcGFzc3Rocm91Z2hcbiAgICAgIGlmICghc2NoZW1hW2tleV0pIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgIH0sXG5cbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFueSBzY2hlbWEgbGVmdG92ZXIgc2hvdWxkIGJlIGFkZGVkIGJhY2sgdG8gb2JqZWN0IGZvciBmdXR1cmUgcHJvdGVjdGlvblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBvbjogW0Z1bmN0aW9uXSxcbiAgZGVzY3JpYmU6IFtPYmplY3RdLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIFVzZXIgZmFjaW5nXG4gIHRvOiBGdW5jdGlvbixcbiAgZnJvbTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICAgIH0sXG4gIH1cblxuICBpZiAoIWNhbGxiYWNrKVxuICAgIHJldHVybiBtb2R1bGVcblxuICBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdID0gZnVuY3Rpb24oZXhwb3J0cykge1xuICAgIGNhbGxiYWNrKG51bGwsIGV4cG9ydHMpXG4gICAgZGVsZXRlIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV1cbiAgfVxuXG4gIGNvbnN0IHNjcmlwdCA9ICdtb2R1bGUucmVzb2x2ZVtcIicgKyBfX2ZpbGVuYW1lICsgJ1wiXShmdW5jdGlvbihpaWZlTW9kdWxlKXtcXG4nICtcbiAgJyAgdmFyIG1vZHVsZSA9IE1vZHVsZShpaWZlTW9kdWxlKVxcbicgK1xuICAnICB2YXIgX19maWxlbmFtZSA9IG1vZHVsZS5maWxlbmFtZVxcbicgK1xuICAnICB2YXIgX19kaXJuYW1lID0gX19maWxlbmFtZS5zbGljZSgwLCBfX2ZpbGVuYW1lLmxhc3RJbmRleE9mKFwiL1wiKSlcXG4nICtcbiAgJyAgdmFyIHJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxcbicgK1xuICAnICB2YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICcgIHZhciBwcm9jZXNzID0geyBicm93c2VyOiB0cnVlIH1cXG4nICtcbiAgJyAgdmFyIEJsdWVwcmludCA9IG51bGw7XFxuXFxuJyArXG5cbiAgJyhmdW5jdGlvbigpIHtcXG4nICsgLy8gQ3JlYXRlIElJRkUgZm9yIG1vZHVsZS9ibHVlcHJpbnRcbiAgJ1widXNlIHN0cmljdFwiO1xcbicgK1xuICAgIGZpbGVDb250ZW50cyArICdcXG4nICtcbiAgJ30pLmNhbGwobW9kdWxlLmV4cG9ydHMpO1xcbicgKyAvLyBDcmVhdGUgJ3RoaXMnIGJpbmRpbmcuXG4gICcgIGlmIChCbHVlcHJpbnQpIHsgcmV0dXJuIEJsdWVwcmludH1cXG4nICtcbiAgJyAgcmV0dXJuIG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICd9KG1vZHVsZSkpOydcblxuICB3aW5kb3cubW9kdWxlID0gbW9kdWxlXG4gIHdpbmRvdy5nbG9iYWwgPSB3aW5kb3dcbiAgd2luZG93Lk1vZHVsZSA9IE1vZHVsZVxuXG4gIHdpbmRvdy5yZXF1aXJlID0gZnVuY3Rpb24odXJsLCBjYWxsYmFjaykge1xuICAgIHdpbmRvdy5odHRwLm1vZHVsZS5pbml0LmNhbGwod2luZG93Lmh0dHAubW9kdWxlKVxuICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gIH1cblxuXG4gIHJldHVybiBzY3JpcHRcbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9kdWxlXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5pbXBvcnQgTW9kdWxlIGZyb20gJy4uLy4uL2xpYi9Nb2R1bGVMb2FkZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi4vLi4vbGliL2V4cG9ydHMnXG5cbi8vIEVtYmVkZGVkIGh0dHAgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGh0dHBMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2h0dHAnLFxuICBwcm90b2NvbDogJ2xvYWRlcicsIC8vIGVtYmVkZGVkIGxvYWRlclxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdIVFRQIExvYWRlcicsXG4gICAgcHJvdG9jb2w6IFsnaHR0cCcsICdodHRwcycsICd3ZWI6Ly8nXSwgLy8gVE9ETzogQ3JlYXRlIGEgd2F5IGZvciBsb2FkZXIgdG8gc3Vic2NyaWJlIHRvIG11bHRpcGxlIHByb3RvY29sc1xuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKCF0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdVUkwgbG9hZGluZyB3aXRoIG5vZGUuanMgbm90IHN1cHBvcnRlZCB5ZXQgKENvbWluZyBzb29uISkuJylcblxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3Nlci5sb2FkLmNhbGwodGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCdodHRwJykgPj0gMClcbiAgICAgICAgcmV0dXJuIGZpbGVOYW1lXG5cbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBjb25zdCBmaWxlUGF0aCA9ICdibHVlcHJpbnRzLycgKyBmaWxlXG4gICAgICByZXR1cm4gZmlsZVBhdGhcbiAgICB9LFxuXG4gICAgYnJvd3Nlcjoge1xuICAgICAgbG9hZDogZnVuY3Rpb24oZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcbiAgICAgICAgbG9nLmRlYnVnKCdbaHR0cCBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVQYXRoKVxuXG4gICAgICAgIHZhciBpc0FzeW5jID0gdHJ1ZVxuICAgICAgICB2YXIgc3luY0ZpbGUgPSBudWxsXG4gICAgICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgICAgICBpc0FzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBpc0FzeW5jKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LnNlbmQobnVsbClcblxuICAgICAgICByZXR1cm4gc3luY0ZpbGVcbiAgICAgIH0sXG5cbiAgICAgIHNjcmlwdEV2ZW50czogZnVuY3Rpb24obG9hZGVyLCBmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gICAgICAgIHRoaXMuZmlsZU5hbWUgPSBmaWxlTmFtZVxuICAgICAgICB0aGlzLm9uTG9hZCA9IGxvYWRlci5icm93c2VyLm9uTG9hZC5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgICAgdGhpcy5vbkVycm9yID0gbG9hZGVyLmJyb3dzZXIub25FcnJvci5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgIH0sXG5cbiAgICAgIG9uTG9hZDogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSB0aGlzXG5cbiAgICAgICAgICBpZiAoc2NyaXB0UmVxdWVzdC5zdGF0dXMgPiA0MDApXG4gICAgICAgICAgICByZXR1cm4gc2NyaXB0RXZlbnRzLm9uRXJyb3IuY2FsbChzY3JpcHRSZXF1ZXN0LCBzY3JpcHRSZXF1ZXN0LnN0YXR1c1RleHQpXG5cbiAgICAgICAgICBjb25zdCBzY3JpcHRDb250ZW50ID0gTW9kdWxlKHNjcmlwdFJlcXVlc3QucmVzcG9uc2VVUkwsIHNjcmlwdFJlcXVlc3QucmVzcG9uc2VUZXh0LCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG5cbiAgICAgICAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudFxuICAgICAgICAgIHZhciBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKVxuICAgICAgICAgIHNjcmlwdFRhZy50ZXh0Q29udGVudCA9IHNjcmlwdENvbnRlbnRcblxuICAgICAgICAgIGh0bWwuYXBwZW5kQ2hpbGQoc2NyaXB0VGFnKVxuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIG9uRXJyb3I6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gc2NyaXB0RXZlbnRzLmZpbGVOYW1lXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFRhZyA9IHRoaXNcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuXG4gICAgICAgICAgLy8gVHJ5IHRvIGZhbGxiYWNrIHRvIGluZGV4LmpzXG4gICAgICAgICAgLy8gRklYTUU6IGluc3RlYWQgb2YgZmFsbGluZyBiYWNrLCB0aGlzIHNob3VsZCBiZSB0aGUgZGVmYXVsdCBpZiBubyBgLmpzYCBpcyBkZXRlY3RlZCwgYnV0IFVSTCB1Z2xpZmllcnMgYW5kIHN1Y2ggd2lsbCBoYXZlIGlzc3Vlcy4uIGhybW1tbS4uXG4gICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSAmJiBmaWxlTmFtZS5pbmRleE9mKCdpbmRleC5qcycpID09PSAtMSkge1xuICAgICAgICAgICAgbG9nLndhcm4oJ1todHRwXSBBdHRlbXB0aW5nIHRvIGZhbGxiYWNrIHRvOiAnLCBmaWxlTmFtZSArICcvaW5kZXguanMnKVxuICAgICAgICAgICAgcmV0dXJuIGxvYWRlci5pbi5jYWxsKGxvYWRlciwgZmlsZU5hbWUgKyAnL2luZGV4LmpzJywgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHNjcmlwdEV2ZW50cy5jYWxsYmFjaygnQ291bGQgbm90IGxvYWQgQmx1ZXByaW50JylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgY2xlYW51cDogZnVuY3Rpb24oc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpIHtcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcbiAgICAgICAgLy9kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdLnJlbW92ZUNoaWxkKHNjcmlwdFRhZykgLy8gVE9ETzogQ2xlYW51cFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgbm9kZToge1xuICAgICAgLy8gU3R1YiBmb3Igbm9kZS5qcyBIVFRQIGxvYWRpbmcgc3VwcG9ydC5cbiAgICB9LFxuXG4gIH0sXG59XG5cbmV4cG9ydGVyKCdodHRwJywgaHR0cExvYWRlcikgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nLmRlYnVnKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuXG4gICAgICAvLyBUT0RPOiBTd2l0Y2ggdG8gYXN5bmMgZmlsZSBsb2FkaW5nLCBpbXByb3ZlIHJlcXVpcmUoKSwgcGFzcyBpbiBJSUZFIHRvIHNhbmRib3gsIHVzZSBJSUZFIHJlc29sdmVyIGZvciBjYWxsYmFja1xuICAgICAgLy8gVE9ETzogQWRkIGVycm9yIHJlcG9ydGluZy5cblxuICAgICAgY29uc3Qgdm0gPSByZXF1aXJlKCd2bScpXG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlRmlsZShmaWxlUGF0aClcbiAgICAgIGlmICghZmlsZSlcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdCbHVlcHJpbnQgbm90IGZvdW5kJylcblxuICAgICAgY29uc3QgZmlsZUNvbnRlbnRzID0gZnMucmVhZEZpbGVTeW5jKGZpbGUpLnRvU3RyaW5nKClcblxuICAgICAgLy9jb25zdCBzYW5kYm94ID0geyBCbHVlcHJpbnQ6IG51bGwgfVxuICAgICAgLy92bS5jcmVhdGVDb250ZXh0KHNhbmRib3gpXG4gICAgICAvL3ZtLnJ1bkluQ29udGV4dChmaWxlQ29udGVudHMsIHNhbmRib3gpXG5cbiAgICAgIGdsb2JhbC5CbHVlcHJpbnQgPSBudWxsXG4gICAgICB2bS5ydW5JblRoaXNDb250ZXh0KGZpbGVDb250ZW50cylcblxuICAgICAgY2FsbGJhY2sobnVsbCwgZ2xvYmFsLkJsdWVwcmludClcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdibHVlcHJpbnRzLycsIGZpbGVOYW1lKVxuICAgIH0sXG5cbiAgICByZXNvbHZlRmlsZTogZnVuY3Rpb24oZmlsZVBhdGgpIHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuXG4gICAgICAvLyBJZiBmaWxlIG9yIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAvLyBDaGVjayBpZiBibHVlcHJpbnQgaXMgYSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgaWYgKGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAgIHJldHVybiBwYXRoLnJlc29sdmUoZmlsZVBhdGgsICdpbmRleC5qcycpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgfVxuXG4gICAgICAvLyBUcnkgYWRkaW5nIGFuIGV4dGVuc2lvbiB0byBzZWUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCBmaWxlID0gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZSkpXG4gICAgICAgIHJldHVybiBmaWxlXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2cuZGVidWcoJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2cuZXJyb3IoJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZy5kZWJ1ZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBWYWxpZGF0ZSBCbHVlcHJpbnQgaW5wdXQgd2l0aCBvcHRpb25hbCBwcm9wZXJ0eSBkZXN0cnVjdHVyaW5nICh1c2luZyBkZXNjcmliZSBvYmplY3QpXG4gICAgICBibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUgPSBoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBjb25zdCBibHVlcHJpbnRCYXNlID0gT2JqZWN0LmNyZWF0ZShCbHVlcHJpbnRCYXNlKVxuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnRCYXNlLCBCbHVlcHJpbnRCYXNlKVxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYmx1ZXByaW50LCAnRnJhbWUnLCB7IHZhbHVlOiBibHVlcHJpbnRCYXNlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHdyaXRhYmxlOiBmYWxzZSB9KSAvLyBUT0RPOiBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZVxuICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IG5hbWVcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpIHtcbiAgLy8gQ3JlYXRlIGJsdWVwcmludCBmcm9tIGNvbnN0cnVjdG9yXG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICAgIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICAgIGNvbnN0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgcmV0dXJuIGJsdWVwcmludFxuICB9XG59XG5cbi8vIEdpdmUgRnJhbWUgYW4gZWFzeSBkZXNjcmlwdG9yXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUsICdDb25zdHJ1Y3RvcicpXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUuY29uc3RydWN0b3IsICdGcmFtZScpXG5cbi8vIEV4cG9ydCBGcmFtZSBnbG9iYWxseVxuZXhwb3J0ZXIoJ0ZyYW1lJywgRnJhbWUpXG5leHBvcnQgZGVmYXVsdCBGcmFtZVxuIl0sIm5hbWVzIjpbImhlbHBlcnMuYXNzaWduT2JqZWN0IiwiaGVscGVycy5zZXREZXNjcmlwdG9yIiwiaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZSJdLCJtYXBwaW5ncyI6Ijs7O0VBRUEsU0FBUyxHQUFHLEdBQUc7RUFDZjtFQUNBLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QjtFQUNBLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUN0QyxFQUFDOztFQUVELEdBQUcsQ0FBQyxJQUFJLEdBQUcsV0FBVztFQUN0QjtFQUNBLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNyQyxFQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QixFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDcEMsQ0FBQzs7RUNu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
