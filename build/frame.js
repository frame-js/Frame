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

    // If we don't have a valid target; return props array instead. Example: ['prop1', 'prop2']
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

        // Used when target blueprint is part of another flow
        if (blueprint && blueprint.Frame)
          blueprint.Frame.parents.push({ target: this }); // TODO: Check if worker blueprint is already added.

        // .from(Events) start the flow at index 0
        pipe.context = createContext(this, pipe.target, 0);
        this.Frame.events.push(pipe);

      } else if (pipe.direction === 'to') {
        if (typeof blueprint.in !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support input.')

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
      state: blueprint.Frame.state,
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

    for (const event of this.Frame.events) {
      const blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);

      // If not already processing flow.
      if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
        ;
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
        blueprint.init = function(_, done) {
          done();
        };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log.error('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed

        blueprint.Frame.props = {};
        blueprint.Frame.initialized = true;
        blueprint.Frame.initializing = false;
        setTimeout(function() { callback && callback.call(blueprint); }, 1);
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
      queue(nextPipe, this, [index, null, data]);
    },

    error: function(index, err) {
      log.error('Worker ' + this.name + '.error:', err, arguments);
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
        this.out(target);
      };
      blueprint.on = function primitiveWrapper() {
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

    // Queue array is primarily for IDE.
    let queuePosition = blueprint.Frame.queue.length;
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
      blueprint.Frame.state = this.Frame.state;
      blueprint.Frame.instance = true;
    }
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    debounce(processFlow, 1, blueprint);
    return blueprint
  }

  function nextPipe(index, err, data) {
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
          queue(nextPipe, blueprint, [0, null, data]);
        }
      }

      return void 0
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
    describe: ['init', 'in', 'out'], // TODO: Change to object and make separate schema. { init: { name: '', description: ' } }
    props: {},
    state: {},

    loaded: false,
    initialized: false,
    processingFlow: false,
    instance: false,

    debounce: {},
    queue: [],
    parents: [],

    pipes: [], //[FlowSchema],
    events: [], //[FlowSchema],
    flow: [], //[FlowSchema],

    isPromised: false,
    promise: {},
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

    value: Function,
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
        let filePath;

        if (url.indexOf('./') !== -1) {
          filePath = url;
        } else if (url.indexOf('http') !== -1) {
          filePath = url;
        } else {
          filePath = '../node_modules/' + url;
        }

        return window.http.module.in.call(window.http.module, filePath, null, callback, true)
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

    window.require = module.require;

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

      in: function(fileName, opts, callback, skipNormalization) {
        if (!this.isBrowser)
          return callback('URL loading with node.js not supported yet (Coming soon!).')

        return this.browser.load.call(this, fileName, callback, skipNormalization)
      },

      normalizeFilePath: function(fileName) {
        if (fileName.indexOf('http') >= 0)
          return fileName

        const file = fileName + ((fileName.indexOf('.js') === -1) ? '.js' : '');
        const filePath = 'blueprints/' + file;
        return filePath
      },

      browser: {
        load: function(fileName, callback, skipNormalization) {
          const filePath = (!skipNormalization) ? this.normalizeFilePath(fileName) : fileName;

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

        // TODO: Switch to async file loading, improve require(), pass in IIFE to sandbox, use IIFE resolver for callback
        // TODO: Add error reporting.

        const vm = require('vm');
        const fs = require('fs');

        const filePath = this.normalizeFilePath(fileName);

        const file = this.resolveFile(filePath);
        if (!file)
          return callback('Blueprint not found')

        const fileContents = fs.readFileSync(file).toString();

        // TODO: Create a more complete sandbox object
        const sandbox = {
          Blueprint: null,
          require: function(moduleFile) { return require(filePath + '/node_modules/' + moduleFile) },
          console: { log: log, error: log.error, warn: log.warn, info: log.info },
          global: global,
          module: module,
          __dirname: filePath,
        };

        vm.createContext(sandbox);
        vm.runInContext(fileContents, sandbox);
        callback(null, sandbox.Blueprint);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmRlYnVnID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGFtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nLmRlYnVnKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZy5kZWJ1ZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgICBpZiAoYmx1ZXByaW50ICYmIGJsdWVwcmludC5GcmFtZSlcbiAgICAgICAgYmx1ZXByaW50LkZyYW1lLnBhcmVudHMucHVzaCh7IHRhcmdldDogdGhpcyB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgMClcbiAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcblxuICAgIH0gZWxzZSBpZiAocGlwZS5kaXJlY3Rpb24gPT09ICd0bycpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50LmluICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgaW5wdXQuJylcblxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDb250ZXh0KHdvcmtlciwgYmx1ZXByaW50LCBpbmRleCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGJsdWVwcmludC5uYW1lLFxuICAgIHN0YXRlOiBibHVlcHJpbnQuRnJhbWUuc3RhdGUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZy5kZWJ1ZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcbiAgICBsb2cuZGVidWcoYmx1ZXByaW50Lm5hbWUsICdwcm9wcycsIHByb3BzKVxuXG4gICAgLy8gSWYgbm90IGFscmVhZHkgcHJvY2Vzc2luZyBmbG93LlxuICAgIGlmIChibHVlcHJpbnQuRnJhbWUucGlwZXMgJiYgYmx1ZXByaW50LkZyYW1lLnBpcGVzLmxlbmd0aCA+IDApXG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJyBpcyBub3Qgc3RhcnRpbmcgJyArIGJsdWVwcmludC5uYW1lICsgJywgd2FpdGluZyBmb3IgaXQgdG8gZmluaXNoJylcbiAgICBlbHNlIGlmICghYmx1ZXByaW50LkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgICAgYmx1ZXByaW50Lm9uLmNhbGwoZXZlbnQuY29udGV4dCwgcHJvcHMpXG4gIH1cbn1cblxuZnVuY3Rpb24gaW5pdEJsdWVwcmludChjYWxsYmFjaykge1xuICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG5cbiAgdHJ5IHtcbiAgICBsZXQgcHJvcHMgPSBibHVlcHJpbnQuRnJhbWUucHJvcHMgPyBibHVlcHJpbnQuRnJhbWUucHJvcHMgOiB7fVxuXG4gICAgLy8gSWYgQmx1ZXByaW50IGZvcmVnb2VzIHRoZSBpbml0aWFsaXplciwgc3R1YiBpdC5cbiAgICBpZiAoIWJsdWVwcmludC5pbml0KVxuICAgICAgYmx1ZXByaW50LmluaXQgPSBmdW5jdGlvbihfLCBkb25lKSB7XG4gICAgICAgIGRvbmUoKVxuICAgICAgfVxuXG4gICAgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW5pdCwgcHJvcHMpXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbihlcnIpIHtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIHJldHVybiBsb2cuZXJyb3IoJ0Vycm9yIGluaXRpYWxpemluZyBibHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG5cbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgJyArIGJsdWVwcmludC5uYW1lICsgJyBpbnRpYWxpemVkJylcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0ge31cbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXplZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXppbmcgPSBmYWxzZVxuICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHsgY2FsbGJhY2sgJiYgY2FsbGJhY2suY2FsbChibHVlcHJpbnQpIH0sIDEpXG4gICAgfSlcblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGNvdWxkIG5vdCBpbml0aWFsaXplLlxcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IHsgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSwgYXNzaWduT2JqZWN0LCBzZXREZXNjcmlwdG9yIH0gZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IHsgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL2Zsb3cnXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAndG8nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgb3V0OiBmdW5jdGlvbihpbmRleCwgZGF0YSkge1xuICAgIGxvZy5kZWJ1ZygnV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLm91dDonLCBkYXRhLCBhcmd1bWVudHMpXG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgbnVsbCwgZGF0YV0pXG4gIH0sXG5cbiAgZXJyb3I6IGZ1bmN0aW9uKGluZGV4LCBlcnIpIHtcbiAgICBsb2cuZXJyb3IoJ1dvcmtlciAnICsgdGhpcy5uYW1lICsgJy5lcnJvcjonLCBlcnIsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBlcnJdKVxuICB9LFxuXG4gIGdldCB2YWx1ZSgpIHtcbiAgICAvLyBCYWlsIGlmIHdlJ3JlIG5vdCByZWFkeS4gKFVzZWQgdG8gZ2V0IG91dCBvZiBPYmplY3RNb2RlbCBhbmQgYXNzaWduT2JqZWN0IGxpbWJvKVxuICAgIGlmICghdGhpcy5GcmFtZSlcbiAgICAgIHJldHVybiAnJ1xuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2VGb3JWYWx1ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgYmx1ZXByaW50LkZyYW1lLmlzUHJvbWlzZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvbWlzZSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QgfVxuICAgIH0pXG4gICAgcmV0dXJuIHByb21pc2VGb3JWYWx1ZVxuICB9LFxufVxuXG4vLyBGbG93IE1ldGhvZCBoZWxwZXJzXG5mdW5jdGlvbiBCbHVlcHJpbnRTdHViKHRhcmdldCkge1xuICBjb25zdCBibHVlcHJpbnQgPSB7fVxuICBhc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIGJsdWVwcmludC5zdHViID0gdHJ1ZVxuICBibHVlcHJpbnQuRnJhbWUgPSB7XG4gICAgcGFyZW50czogW10sXG4gICAgZGVzY3JpYmU6IFtdLFxuICB9XG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBzZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0Z1bmN0aW9uJylcbiAgICBibHVlcHJpbnQuaW4gPSB0YXJnZXRcbiAgICBibHVlcHJpbnQub24gPSB0YXJnZXRcbiAgfSBlbHNlIHtcbiAgICBzZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ1ByaW1pdGl2ZScpXG4gICAgYmx1ZXByaW50LmluID0gZnVuY3Rpb24gcHJpbWl0aXZlV3JhcHBlcigpIHtcbiAgICAgIGxvZy5kZWJ1Zyh0aGlzLm5hbWUgKyAnLmluOicsIHRhcmdldClcbiAgICAgIHRoaXMub3V0KHRhcmdldClcbiAgICB9XG4gICAgYmx1ZXByaW50Lm9uID0gZnVuY3Rpb24gcHJpbWl0aXZlV3JhcHBlcigpIHtcbiAgICAgIGxvZy5kZWJ1Zyh0aGlzLm5hbWUgKyAnLm9uOicsIHRhcmdldClcbiAgICAgIHRoaXMub3V0KHRhcmdldClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZ1bmMsIHdhaXQsIGJsdWVwcmludCwgYXJncykge1xuICBjb25zdCBuYW1lID0gZnVuYy5uYW1lXG4gIGNsZWFyVGltZW91dChibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0pXG4gIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCB3YWl0KVxufVxuXG5mdW5jdGlvbiBxdWV1ZShmdW5jLCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgaWYgKCFibHVlcHJpbnQuRnJhbWUucXVldWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlID0gW11cblxuICAvLyBRdWV1ZSBhcnJheSBpcyBwcmltYXJpbHkgZm9yIElERS5cbiAgbGV0IHF1ZXVlUG9zaXRpb24gPSBibHVlcHJpbnQuRnJhbWUucXVldWUubGVuZ3RoXG4gIGJsdWVwcmludC5GcmFtZS5xdWV1ZS5wdXNoKHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgLy8gVE9ETzogQ2xlYW51cCBxdWV1ZVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCAxKSlcbn1cblxuZnVuY3Rpb24gZmFjdG9yeShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgfVxufVxuXG4vLyBQaXBlIGNvbnRyb2xcbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGluc3RhbmNlLCBkaWQgeW91IGFzc2lnbiB0aGUgbWV0aG9kIHRvIGEgdmFyaWFibGU/JylcblxuICBpZiAoIXRoaXMuRnJhbWUgfHwgIXRoaXMuRnJhbWUucGlwZXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3Qgd29ya2luZyB3aXRoIGEgdmFsaWQgQmx1ZXByaW50IG9iamVjdCcpXG5cbiAgaWYgKCF0YXJnZXQpXG4gICAgdGhyb3cgbmV3IEVycm9yKHRoaXMuRnJhbWUubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKSB3YXMgY2FsbGVkIHdpdGggaW1wcm9wZXIgcGFyYW1ldGVycycpXG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHRhcmdldC50byAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9IGVsc2UgaWYgKHR5cGVvZiB0YXJnZXQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfVxuXG4gIC8vIEVuc3VyZSB3ZSdyZSB3b3JraW5nIG9uIGEgbmV3IGluc3RhbmNlIG9mIHdvcmtlciBibHVlcHJpbnRcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcbiAgaWYgKCFibHVlcHJpbnQuRnJhbWUuaW5zdGFuY2UpIHtcbiAgICBibHVlcHJpbnQgPSBibHVlcHJpbnQoKVxuICAgIGJsdWVwcmludC5GcmFtZS5zdGF0ZSA9IHRoaXMuRnJhbWUuc3RhdGVcbiAgICBibHVlcHJpbnQuRnJhbWUuaW5zdGFuY2UgPSB0cnVlXG4gIH1cblxuICBsb2cuZGVidWcoYmx1ZXByaW50Lm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCk6ICcgKyB0YXJnZXQubmFtZSlcbiAgYmx1ZXByaW50LkZyYW1lLnBpcGVzLnB1c2goeyBkaXJlY3Rpb246IGRpcmVjdGlvbiwgdGFyZ2V0OiB0YXJnZXQsIHBhcmFtczogcGFyYW1zIH0pXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGxvZy5kZWJ1ZygnbmV4dDonLCBpbmRleClcbiAgaWYgKGVycikge1xuICAgIGxvZy5lcnJvcignVE9ETzogaGFuZGxlIGVycm9yOicsIGVycilcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGNvbnRleHQsIGRhdGEsIHByb3BzLCBuZXcgZmFjdG9yeShwaXBlQ2FsbGJhY2spLmJpbmQoY29udGV4dCkpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnRleHQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGNvbnRleHQub3V0KHJldFZhbHVlKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBpcGVDYWxsYmFjayhlcnIsIGRhdGEpIHtcbiAgaWYgKGVycilcbiAgICByZXR1cm4gdGhpcy5lcnJvcihlcnIpXG5cbiAgcmV0dXJuIHRoaXMub3V0KGRhdGEpXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuY29uc3QgRmxvd1NjaGVtYSA9IHtcbiAgZGlyZWN0aW9uOiAnJywgLy8gdG8gb3IgZnJvbVxuICB0YXJnZXQ6IG51bGwsXG4gIHBhcmFtczogW10sXG4gIGNvbnRleHQ6IHtcbiAgICBuYW1lOiAnJyxcbiAgICBzdGF0ZToge30sXG4gICAgb3V0OiBmdW5jdGlvbigpe30sXG4gICAgZXJyb3I6IGZ1bmN0aW9uKCl7fSxcbiAgfVxufVxuXG4vLyBJbnRlcm5hbCBGcmFtZSBwcm9wc1xuY29uc3QgQmx1ZXByaW50QmFzZSA9IHtcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sIC8vIFRPRE86IENoYW5nZSB0byBvYmplY3QgYW5kIG1ha2Ugc2VwYXJhdGUgc2NoZW1hLiB7IGluaXQ6IHsgbmFtZTogJycsIGRlc2NyaXB0aW9uOiAnIH0gfVxuICBwcm9wczoge30sXG4gIHN0YXRlOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgaW5zdGFuY2U6IGZhbHNlLFxuXG4gIGRlYm91bmNlOiB7fSxcbiAgcXVldWU6IFtdLFxuICBwYXJlbnRzOiBbXSxcblxuICBwaXBlczogW10sIC8vW0Zsb3dTY2hlbWFdLFxuICBldmVudHM6IFtdLCAvL1tGbG93U2NoZW1hXSxcbiAgZmxvdzogW10sIC8vW0Zsb3dTY2hlbWFdLFxuXG4gIGlzUHJvbWlzZWQ6IGZhbHNlLFxuICBwcm9taXNlOiB7fSxcbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50QmFzZVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIENvbmNlcHQgYmFzZWQgb246IGh0dHA6Ly9vYmplY3Rtb2RlbC5qcy5vcmcvXG5mdW5jdGlvbiBPYmplY3RNb2RlbChzY2hlbWFPYmopIHtcbiAgaWYgKHR5cGVvZiBzY2hlbWFPYmogPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4geyB0eXBlOiBzY2hlbWFPYmoubmFtZSwgZXhwZWN0czogc2NoZW1hT2JqIH1cbiAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hT2JqICE9PSAnb2JqZWN0JylcbiAgICBzY2hlbWFPYmogPSB7fVxuXG4gIC8vIENsb25lIHNjaGVtYSBvYmplY3Qgc28gd2UgZG9uJ3QgbXV0YXRlIGl0LlxuICBjb25zdCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgY29uc3Qgc2NoZW1hQXJyID0gc2NoZW1hW2tleV1cbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogZmFsc2UsIHR5cGU6ICdvcHRpb25hbCcsIHR5cGVzOiBbXSB9XG4gICAgICBmb3IgKGNvbnN0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBjb25zdCBwcm94eU9iaiA9IHt9XG4gICAgY29uc3Qgb2JqID0gb2JqVG9WYWxpZGF0ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcblxuICB2YWx1ZTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICBsZXQgZmlsZVBhdGhcblxuICAgICAgaWYgKHVybC5pbmRleE9mKCcuLycpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybFxuICAgICAgfSBlbHNlIGlmICh1cmwuaW5kZXhPZignaHR0cCcpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbGVQYXRoID0gJy4uL25vZGVfbW9kdWxlcy8nICsgdXJsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIGZpbGVQYXRoLCBudWxsLCBjYWxsYmFjaywgdHJ1ZSlcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbikge1xuICAgICAgaWYgKCF0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdVUkwgbG9hZGluZyB3aXRoIG5vZGUuanMgbm90IHN1cHBvcnRlZCB5ZXQgKENvbWluZyBzb29uISkuJylcblxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3Nlci5sb2FkLmNhbGwodGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbilcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBjb25zdCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgY29uc3QgZmlsZVBhdGggPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVQYXRoXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaywgc2tpcE5vcm1hbGl6YXRpb24pIHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSAoIXNraXBOb3JtYWxpemF0aW9uKSA/IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpIDogZmlsZU5hbWVcbiAgICAgICAgbG9nLmRlYnVnKCdbaHR0cCBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVQYXRoKVxuXG4gICAgICAgIHZhciBpc0FzeW5jID0gdHJ1ZVxuICAgICAgICB2YXIgc3luY0ZpbGUgPSBudWxsXG4gICAgICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgICAgICBpc0FzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBpc0FzeW5jKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LnNlbmQobnVsbClcblxuICAgICAgICByZXR1cm4gc3luY0ZpbGVcbiAgICAgIH0sXG5cbiAgICAgIHNjcmlwdEV2ZW50czogZnVuY3Rpb24obG9hZGVyLCBmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gICAgICAgIHRoaXMuZmlsZU5hbWUgPSBmaWxlTmFtZVxuICAgICAgICB0aGlzLm9uTG9hZCA9IGxvYWRlci5icm93c2VyLm9uTG9hZC5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgICAgdGhpcy5vbkVycm9yID0gbG9hZGVyLmJyb3dzZXIub25FcnJvci5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgIH0sXG5cbiAgICAgIG9uTG9hZDogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSB0aGlzXG5cbiAgICAgICAgICBpZiAoc2NyaXB0UmVxdWVzdC5zdGF0dXMgPiA0MDApXG4gICAgICAgICAgICByZXR1cm4gc2NyaXB0RXZlbnRzLm9uRXJyb3IuY2FsbChzY3JpcHRSZXF1ZXN0LCBzY3JpcHRSZXF1ZXN0LnN0YXR1c1RleHQpXG5cbiAgICAgICAgICBjb25zdCBzY3JpcHRDb250ZW50ID0gTW9kdWxlKHNjcmlwdFJlcXVlc3QucmVzcG9uc2VVUkwsIHNjcmlwdFJlcXVlc3QucmVzcG9uc2VUZXh0LCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG5cbiAgICAgICAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudFxuICAgICAgICAgIHZhciBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKVxuICAgICAgICAgIHNjcmlwdFRhZy50ZXh0Q29udGVudCA9IHNjcmlwdENvbnRlbnRcblxuICAgICAgICAgIGh0bWwuYXBwZW5kQ2hpbGQoc2NyaXB0VGFnKVxuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIG9uRXJyb3I6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gc2NyaXB0RXZlbnRzLmZpbGVOYW1lXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFRhZyA9IHRoaXNcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuXG4gICAgICAgICAgLy8gVHJ5IHRvIGZhbGxiYWNrIHRvIGluZGV4LmpzXG4gICAgICAgICAgLy8gRklYTUU6IGluc3RlYWQgb2YgZmFsbGluZyBiYWNrLCB0aGlzIHNob3VsZCBiZSB0aGUgZGVmYXVsdCBpZiBubyBgLmpzYCBpcyBkZXRlY3RlZCwgYnV0IFVSTCB1Z2xpZmllcnMgYW5kIHN1Y2ggd2lsbCBoYXZlIGlzc3Vlcy4uIGhybW1tbS4uXG4gICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSAmJiBmaWxlTmFtZS5pbmRleE9mKCdpbmRleC5qcycpID09PSAtMSkge1xuICAgICAgICAgICAgbG9nLndhcm4oJ1todHRwXSBBdHRlbXB0aW5nIHRvIGZhbGxiYWNrIHRvOiAnLCBmaWxlTmFtZSArICcvaW5kZXguanMnKVxuICAgICAgICAgICAgcmV0dXJuIGxvYWRlci5pbi5jYWxsKGxvYWRlciwgZmlsZU5hbWUgKyAnL2luZGV4LmpzJywgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHNjcmlwdEV2ZW50cy5jYWxsYmFjaygnQ291bGQgbm90IGxvYWQgQmx1ZXByaW50JylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgY2xlYW51cDogZnVuY3Rpb24oc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpIHtcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcbiAgICAgICAgLy9kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdLnJlbW92ZUNoaWxkKHNjcmlwdFRhZykgLy8gVE9ETzogQ2xlYW51cFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgbm9kZToge1xuICAgICAgLy8gU3R1YiBmb3Igbm9kZS5qcyBIVFRQIGxvYWRpbmcgc3VwcG9ydC5cbiAgICB9LFxuXG4gIH0sXG59XG5cbmV4cG9ydGVyKCdodHRwJywgaHR0cExvYWRlcikgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nLmRlYnVnKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuXG4gICAgICAvLyBUT0RPOiBTd2l0Y2ggdG8gYXN5bmMgZmlsZSBsb2FkaW5nLCBpbXByb3ZlIHJlcXVpcmUoKSwgcGFzcyBpbiBJSUZFIHRvIHNhbmRib3gsIHVzZSBJSUZFIHJlc29sdmVyIGZvciBjYWxsYmFja1xuICAgICAgLy8gVE9ETzogQWRkIGVycm9yIHJlcG9ydGluZy5cblxuICAgICAgY29uc3Qgdm0gPSByZXF1aXJlKCd2bScpXG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlRmlsZShmaWxlUGF0aClcbiAgICAgIGlmICghZmlsZSlcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdCbHVlcHJpbnQgbm90IGZvdW5kJylcblxuICAgICAgY29uc3QgZmlsZUNvbnRlbnRzID0gZnMucmVhZEZpbGVTeW5jKGZpbGUpLnRvU3RyaW5nKClcblxuICAgICAgLy8gVE9ETzogQ3JlYXRlIGEgbW9yZSBjb21wbGV0ZSBzYW5kYm94IG9iamVjdFxuICAgICAgY29uc3Qgc2FuZGJveCA9IHtcbiAgICAgICAgQmx1ZXByaW50OiBudWxsLFxuICAgICAgICByZXF1aXJlOiBmdW5jdGlvbihtb2R1bGVGaWxlKSB7IHJldHVybiByZXF1aXJlKGZpbGVQYXRoICsgJy9ub2RlX21vZHVsZXMvJyArIG1vZHVsZUZpbGUpIH0sXG4gICAgICAgIGNvbnNvbGU6IHsgbG9nOiBsb2csIGVycm9yOiBsb2cuZXJyb3IsIHdhcm46IGxvZy53YXJuLCBpbmZvOiBsb2cuaW5mbyB9LFxuICAgICAgICBnbG9iYWw6IGdsb2JhbCxcbiAgICAgICAgbW9kdWxlOiBtb2R1bGUsXG4gICAgICAgIF9fZGlybmFtZTogZmlsZVBhdGgsXG4gICAgICB9XG5cbiAgICAgIHZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIHZtLnJ1bkluQ29udGV4dChmaWxlQ29udGVudHMsIHNhbmRib3gpXG4gICAgICBjYWxsYmFjayhudWxsLCBzYW5kYm94LkJsdWVwcmludClcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdibHVlcHJpbnRzLycsIGZpbGVOYW1lKVxuICAgIH0sXG5cbiAgICByZXNvbHZlRmlsZTogZnVuY3Rpb24oZmlsZVBhdGgpIHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuXG4gICAgICAvLyBJZiBmaWxlIG9yIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAvLyBDaGVjayBpZiBibHVlcHJpbnQgaXMgYSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgaWYgKGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAgIHJldHVybiBwYXRoLnJlc29sdmUoZmlsZVBhdGgsICdpbmRleC5qcycpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgfVxuXG4gICAgICAvLyBUcnkgYWRkaW5nIGFuIGV4dGVuc2lvbiB0byBzZWUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCBmaWxlID0gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZSkpXG4gICAgICAgIHJldHVybiBmaWxlXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2cuZGVidWcoJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2cuZXJyb3IoJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZy5kZWJ1ZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBWYWxpZGF0ZSBCbHVlcHJpbnQgaW5wdXQgd2l0aCBvcHRpb25hbCBwcm9wZXJ0eSBkZXN0cnVjdHVyaW5nICh1c2luZyBkZXNjcmliZSBvYmplY3QpXG4gICAgICBibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUgPSBoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBjb25zdCBibHVlcHJpbnRCYXNlID0gT2JqZWN0LmNyZWF0ZShCbHVlcHJpbnRCYXNlKVxuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnRCYXNlLCBCbHVlcHJpbnRCYXNlKVxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYmx1ZXByaW50LCAnRnJhbWUnLCB7IHZhbHVlOiBibHVlcHJpbnRCYXNlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHdyaXRhYmxlOiBmYWxzZSB9KSAvLyBUT0RPOiBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZVxuICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IG5hbWVcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpIHtcbiAgLy8gQ3JlYXRlIGJsdWVwcmludCBmcm9tIGNvbnN0cnVjdG9yXG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICAgIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICAgIGNvbnN0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgbG9nLmRlYnVnKCdjb25zdHJ1Y3RvciBjYWxsZWQgZm9yJywgbmFtZSlcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciIsImhlbHBlcnMu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
