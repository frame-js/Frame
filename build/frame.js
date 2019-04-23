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

    //catch: function(callback){ ... }
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
      blueprint = blueprint(Array.from(blueprint.Frame.props)[0]);
      blueprint.Frame.state = this.Frame.state; // TODO: Should create a new state object?
      blueprint.Frame.instance = true;
    }
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    debounce(processFlow, 1, blueprint);
    return blueprint
  }

  function nextPipe(index, err, data) {

    const flow = this.Frame.flow;
    const next = flow[index];

    if (err) {
      if (!next || !next.target)
        return void 0

      if (next.target.name === 'Error') {
        next.context.handleError = true;
        data = err;
      } else {
        index++;
        return nextPipe.call(this, index, err)
      }
    }

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmRlYnVnID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGFtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nLmRlYnVnKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZy5kZWJ1ZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgICBpZiAoYmx1ZXByaW50ICYmIGJsdWVwcmludC5GcmFtZSlcbiAgICAgICAgYmx1ZXByaW50LkZyYW1lLnBhcmVudHMucHVzaCh7IHRhcmdldDogdGhpcyB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgMClcbiAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcblxuICAgIH0gZWxzZSBpZiAocGlwZS5kaXJlY3Rpb24gPT09ICd0bycpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50LmluICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgaW5wdXQuJylcblxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDb250ZXh0KHdvcmtlciwgYmx1ZXByaW50LCBpbmRleCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGJsdWVwcmludC5uYW1lLFxuICAgIHN0YXRlOiBibHVlcHJpbnQuRnJhbWUuc3RhdGUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZy5kZWJ1ZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcbiAgICBsb2cuZGVidWcoYmx1ZXByaW50Lm5hbWUsICdwcm9wcycsIHByb3BzKVxuXG4gICAgLy8gSWYgbm90IGFscmVhZHkgcHJvY2Vzc2luZyBmbG93LlxuICAgIGlmIChibHVlcHJpbnQuRnJhbWUucGlwZXMgJiYgYmx1ZXByaW50LkZyYW1lLnBpcGVzLmxlbmd0aCA+IDApXG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJyBpcyBub3Qgc3RhcnRpbmcgJyArIGJsdWVwcmludC5uYW1lICsgJywgd2FpdGluZyBmb3IgaXQgdG8gZmluaXNoJylcbiAgICBlbHNlIGlmICghYmx1ZXByaW50LkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgICAgYmx1ZXByaW50Lm9uLmNhbGwoZXZlbnQuY29udGV4dCwgcHJvcHMpXG4gIH1cbn1cblxuZnVuY3Rpb24gaW5pdEJsdWVwcmludChjYWxsYmFjaykge1xuICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG5cbiAgdHJ5IHtcbiAgICBsZXQgcHJvcHMgPSBibHVlcHJpbnQuRnJhbWUucHJvcHMgPyBibHVlcHJpbnQuRnJhbWUucHJvcHMgOiB7fVxuXG4gICAgLy8gSWYgQmx1ZXByaW50IGZvcmVnb2VzIHRoZSBpbml0aWFsaXplciwgc3R1YiBpdC5cbiAgICBpZiAoIWJsdWVwcmludC5pbml0KVxuICAgICAgYmx1ZXByaW50LmluaXQgPSBmdW5jdGlvbihfLCBkb25lKSB7XG4gICAgICAgIGRvbmUoKVxuICAgICAgfVxuXG4gICAgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW5pdCwgcHJvcHMpXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbihlcnIpIHtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIHJldHVybiBsb2cuZXJyb3IoJ0Vycm9yIGluaXRpYWxpemluZyBibHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG5cbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgJyArIGJsdWVwcmludC5uYW1lICsgJyBpbnRpYWxpemVkJylcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0ge31cbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXplZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXppbmcgPSBmYWxzZVxuICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHsgY2FsbGJhY2sgJiYgY2FsbGJhY2suY2FsbChibHVlcHJpbnQpIH0sIDEpXG4gICAgfSlcblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGNvdWxkIG5vdCBpbml0aWFsaXplLlxcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IHsgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSwgYXNzaWduT2JqZWN0LCBzZXREZXNjcmlwdG9yIH0gZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IHsgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL2Zsb3cnXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAndG8nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgb3V0OiBmdW5jdGlvbihpbmRleCwgZGF0YSkge1xuICAgIGxvZy5kZWJ1ZygnV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLm91dDonLCBkYXRhLCBhcmd1bWVudHMpXG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgbnVsbCwgZGF0YV0pXG4gIH0sXG5cbiAgZXJyb3I6IGZ1bmN0aW9uKGluZGV4LCBlcnIpIHtcbiAgICBsb2cuZXJyb3IoJ1dvcmtlciAnICsgdGhpcy5uYW1lICsgJy5lcnJvcjonLCBlcnIsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBlcnJdKVxuICB9LFxuXG4gIGdldCB2YWx1ZSgpIHtcbiAgICAvLyBCYWlsIGlmIHdlJ3JlIG5vdCByZWFkeS4gKFVzZWQgdG8gZ2V0IG91dCBvZiBPYmplY3RNb2RlbCBhbmQgYXNzaWduT2JqZWN0IGxpbWJvKVxuICAgIGlmICghdGhpcy5GcmFtZSlcbiAgICAgIHJldHVybiAnJ1xuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2VGb3JWYWx1ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgYmx1ZXByaW50LkZyYW1lLmlzUHJvbWlzZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvbWlzZSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QgfVxuICAgIH0pXG4gICAgcmV0dXJuIHByb21pc2VGb3JWYWx1ZVxuICB9LFxuXG4gIC8vY2F0Y2g6IGZ1bmN0aW9uKGNhbGxiYWNrKXsgLi4uIH1cbn1cblxuLy8gRmxvdyBNZXRob2QgaGVscGVyc1xuZnVuY3Rpb24gQmx1ZXByaW50U3R1Yih0YXJnZXQpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0ge31cbiAgYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICBibHVlcHJpbnQuc3R1YiA9IHRydWVcbiAgYmx1ZXByaW50LkZyYW1lID0ge1xuICAgIHBhcmVudHM6IFtdLFxuICAgIGRlc2NyaWJlOiBbXSxcbiAgfVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdGdW5jdGlvbicpXG4gICAgYmx1ZXByaW50LmluID0gdGFyZ2V0XG4gICAgYmx1ZXByaW50Lm9uID0gdGFyZ2V0XG4gIH0gZWxzZSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdQcmltaXRpdmUnKVxuICAgIGJsdWVwcmludC5pbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5pbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICAgIGJsdWVwcmludC5vbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5vbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgY29uc3QgbmFtZSA9IGZ1bmMubmFtZVxuICBjbGVhclRpbWVvdXQoYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdKVxuICBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0gPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV1cbiAgICBmdW5jLmFwcGx5KGJsdWVwcmludCwgYXJncylcbiAgfSwgd2FpdClcbn1cblxuZnVuY3Rpb24gcXVldWUoZnVuYywgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGlmICghYmx1ZXByaW50LkZyYW1lLnF1ZXVlKVxuICAgIGJsdWVwcmludC5GcmFtZS5xdWV1ZSA9IFtdXG5cbiAgLy8gUXVldWUgYXJyYXkgaXMgcHJpbWFyaWx5IGZvciBJREUuXG4gIGxldCBxdWV1ZVBvc2l0aW9uID0gYmx1ZXByaW50LkZyYW1lLnF1ZXVlLmxlbmd0aFxuICBibHVlcHJpbnQuRnJhbWUucXVldWUucHVzaChzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIC8vIFRPRE86IENsZWFudXAgcXVldWVcbiAgICBmdW5jLmFwcGx5KGJsdWVwcmludCwgYXJncylcbiAgfSwgMSkpXG59XG5cbmZ1bmN0aW9uIGZhY3RvcnkoZm4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cbn1cblxuLy8gUGlwZSBjb250cm9sXG5mdW5jdGlvbiBhZGRQaXBlKGRpcmVjdGlvbiwgdGFyZ2V0LCBwYXJhbXMpIHtcbiAgaWYgKCF0aGlzKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG1ldGhvZCBjYWxsZWQgd2l0aG91dCBpbnN0YW5jZSwgZGlkIHlvdSBhc3NpZ24gdGhlIG1ldGhvZCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiB0YXJnZXQudG8gIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH1cblxuICAvLyBFbnN1cmUgd2UncmUgd29ya2luZyBvbiBhIG5ldyBpbnN0YW5jZSBvZiB3b3JrZXIgYmx1ZXByaW50XG4gIGxldCBibHVlcHJpbnQgPSB0aGlzXG4gIGlmICghYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlKSB7XG4gICAgbG9nLmRlYnVnKCdDcmVhdGluZyBuZXcgaW5zdGFuY2UgZm9yJywgYmx1ZXByaW50Lm5hbWUpXG4gICAgYmx1ZXByaW50ID0gYmx1ZXByaW50KEFycmF5LmZyb20oYmx1ZXByaW50LkZyYW1lLnByb3BzKVswXSlcbiAgICBibHVlcHJpbnQuRnJhbWUuc3RhdGUgPSB0aGlzLkZyYW1lLnN0YXRlIC8vIFRPRE86IFNob3VsZCBjcmVhdGUgYSBuZXcgc3RhdGUgb2JqZWN0P1xuICAgIGJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSA9IHRydWVcbiAgfVxuXG4gIGxvZy5kZWJ1ZyhibHVlcHJpbnQubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKTogJyArIHRhcmdldC5uYW1lKVxuICBibHVlcHJpbnQuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIG5leHRQaXBlKGluZGV4LCBlcnIsIGRhdGEpIHtcbiAgbG9nLmRlYnVnKCduZXh0OicsIGluZGV4KVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgaWYgKGVycikge1xuICAgIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpXG4gICAgICByZXR1cm4gbG9nLmRlYnVnKCdObyBlcnJvciBoYW5kbGVyJylcblxuICAgIGlmIChuZXh0LnRhcmdldC5uYW1lID09PSAnRXJyb3InKSB7XG4gICAgICBuZXh0LmNvbnRleHQuaGFuZGxlRXJyb3IgPSB0cnVlXG4gICAgICBkYXRhID0gZXJyXG4gICAgfSBlbHNlIHtcbiAgICAgIGluZGV4KytcbiAgICAgIHJldHVybiBuZXh0UGlwZS5jYWxsKHRoaXMsIGluZGV4LCBlcnIpXG4gICAgfVxuICB9XG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGNvbnRleHQsIGRhdGEsIHByb3BzLCBuZXcgZmFjdG9yeShwaXBlQ2FsbGJhY2spLmJpbmQoY29udGV4dCkpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnRleHQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGNvbnRleHQub3V0KHJldFZhbHVlKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBpcGVDYWxsYmFjayhlcnIsIGRhdGEpIHtcbiAgaWYgKGVycilcbiAgICByZXR1cm4gdGhpcy5lcnJvcihlcnIpXG5cbiAgcmV0dXJuIHRoaXMub3V0KGRhdGEpXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuY29uc3QgRmxvd1NjaGVtYSA9IHtcbiAgZGlyZWN0aW9uOiAnJywgLy8gdG8gb3IgZnJvbVxuICB0YXJnZXQ6IG51bGwsXG4gIHBhcmFtczogW10sXG4gIGNvbnRleHQ6IHtcbiAgICBuYW1lOiAnJyxcbiAgICBzdGF0ZToge30sXG4gICAgb3V0OiBmdW5jdGlvbigpe30sXG4gICAgZXJyb3I6IGZ1bmN0aW9uKCl7fSxcbiAgfVxufVxuXG4vLyBJbnRlcm5hbCBGcmFtZSBwcm9wc1xuY29uc3QgQmx1ZXByaW50QmFzZSA9IHtcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sIC8vIFRPRE86IENoYW5nZSB0byBvYmplY3QgYW5kIG1ha2Ugc2VwYXJhdGUgc2NoZW1hLiB7IGluaXQ6IHsgbmFtZTogJycsIGRlc2NyaXB0aW9uOiAnIH0gfVxuICBwcm9wczoge30sXG4gIHN0YXRlOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgaW5zdGFuY2U6IGZhbHNlLFxuXG4gIGRlYm91bmNlOiB7fSxcbiAgcXVldWU6IFtdLFxuICBwYXJlbnRzOiBbXSxcblxuICBwaXBlczogW10sIC8vW0Zsb3dTY2hlbWFdLFxuICBldmVudHM6IFtdLCAvL1tGbG93U2NoZW1hXSxcbiAgZmxvdzogW10sIC8vW0Zsb3dTY2hlbWFdLFxuXG4gIGlzUHJvbWlzZWQ6IGZhbHNlLFxuICBwcm9taXNlOiB7fSxcbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50QmFzZVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIENvbmNlcHQgYmFzZWQgb246IGh0dHA6Ly9vYmplY3Rtb2RlbC5qcy5vcmcvXG5mdW5jdGlvbiBPYmplY3RNb2RlbChzY2hlbWFPYmopIHtcbiAgaWYgKHR5cGVvZiBzY2hlbWFPYmogPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4geyB0eXBlOiBzY2hlbWFPYmoubmFtZSwgZXhwZWN0czogc2NoZW1hT2JqIH1cbiAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hT2JqICE9PSAnb2JqZWN0JylcbiAgICBzY2hlbWFPYmogPSB7fVxuXG4gIC8vIENsb25lIHNjaGVtYSBvYmplY3Qgc28gd2UgZG9uJ3QgbXV0YXRlIGl0LlxuICBjb25zdCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgY29uc3Qgc2NoZW1hQXJyID0gc2NoZW1hW2tleV1cbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogZmFsc2UsIHR5cGU6ICdvcHRpb25hbCcsIHR5cGVzOiBbXSB9XG4gICAgICBmb3IgKGNvbnN0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBjb25zdCBwcm94eU9iaiA9IHt9XG4gICAgY29uc3Qgb2JqID0gb2JqVG9WYWxpZGF0ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcblxuICB2YWx1ZTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICBsZXQgZmlsZVBhdGhcblxuICAgICAgaWYgKHVybC5pbmRleE9mKCcuLycpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybFxuICAgICAgfSBlbHNlIGlmICh1cmwuaW5kZXhPZignaHR0cCcpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbGVQYXRoID0gJy4uL25vZGVfbW9kdWxlcy8nICsgdXJsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIGZpbGVQYXRoLCBudWxsLCBjYWxsYmFjaywgdHJ1ZSlcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbikge1xuICAgICAgaWYgKCF0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdVUkwgbG9hZGluZyB3aXRoIG5vZGUuanMgbm90IHN1cHBvcnRlZCB5ZXQgKENvbWluZyBzb29uISkuJylcblxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3Nlci5sb2FkLmNhbGwodGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbilcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBjb25zdCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgY29uc3QgZmlsZVBhdGggPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVQYXRoXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaywgc2tpcE5vcm1hbGl6YXRpb24pIHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSAoIXNraXBOb3JtYWxpemF0aW9uKSA/IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpIDogZmlsZU5hbWVcbiAgICAgICAgbG9nLmRlYnVnKCdbaHR0cCBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVQYXRoKVxuXG4gICAgICAgIHZhciBpc0FzeW5jID0gdHJ1ZVxuICAgICAgICB2YXIgc3luY0ZpbGUgPSBudWxsXG4gICAgICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgICAgICBpc0FzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBpc0FzeW5jKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LnNlbmQobnVsbClcblxuICAgICAgICByZXR1cm4gc3luY0ZpbGVcbiAgICAgIH0sXG5cbiAgICAgIHNjcmlwdEV2ZW50czogZnVuY3Rpb24obG9hZGVyLCBmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gICAgICAgIHRoaXMuZmlsZU5hbWUgPSBmaWxlTmFtZVxuICAgICAgICB0aGlzLm9uTG9hZCA9IGxvYWRlci5icm93c2VyLm9uTG9hZC5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgICAgdGhpcy5vbkVycm9yID0gbG9hZGVyLmJyb3dzZXIub25FcnJvci5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgIH0sXG5cbiAgICAgIG9uTG9hZDogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSB0aGlzXG5cbiAgICAgICAgICBpZiAoc2NyaXB0UmVxdWVzdC5zdGF0dXMgPiA0MDApXG4gICAgICAgICAgICByZXR1cm4gc2NyaXB0RXZlbnRzLm9uRXJyb3IuY2FsbChzY3JpcHRSZXF1ZXN0LCBzY3JpcHRSZXF1ZXN0LnN0YXR1c1RleHQpXG5cbiAgICAgICAgICBjb25zdCBzY3JpcHRDb250ZW50ID0gTW9kdWxlKHNjcmlwdFJlcXVlc3QucmVzcG9uc2VVUkwsIHNjcmlwdFJlcXVlc3QucmVzcG9uc2VUZXh0LCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG5cbiAgICAgICAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudFxuICAgICAgICAgIHZhciBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKVxuICAgICAgICAgIHNjcmlwdFRhZy50ZXh0Q29udGVudCA9IHNjcmlwdENvbnRlbnRcblxuICAgICAgICAgIGh0bWwuYXBwZW5kQ2hpbGQoc2NyaXB0VGFnKVxuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIG9uRXJyb3I6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gc2NyaXB0RXZlbnRzLmZpbGVOYW1lXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFRhZyA9IHRoaXNcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuXG4gICAgICAgICAgLy8gVHJ5IHRvIGZhbGxiYWNrIHRvIGluZGV4LmpzXG4gICAgICAgICAgLy8gRklYTUU6IGluc3RlYWQgb2YgZmFsbGluZyBiYWNrLCB0aGlzIHNob3VsZCBiZSB0aGUgZGVmYXVsdCBpZiBubyBgLmpzYCBpcyBkZXRlY3RlZCwgYnV0IFVSTCB1Z2xpZmllcnMgYW5kIHN1Y2ggd2lsbCBoYXZlIGlzc3Vlcy4uIGhybW1tbS4uXG4gICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSAmJiBmaWxlTmFtZS5pbmRleE9mKCdpbmRleC5qcycpID09PSAtMSkge1xuICAgICAgICAgICAgbG9nLndhcm4oJ1todHRwXSBBdHRlbXB0aW5nIHRvIGZhbGxiYWNrIHRvOiAnLCBmaWxlTmFtZSArICcvaW5kZXguanMnKVxuICAgICAgICAgICAgcmV0dXJuIGxvYWRlci5pbi5jYWxsKGxvYWRlciwgZmlsZU5hbWUgKyAnL2luZGV4LmpzJywgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHNjcmlwdEV2ZW50cy5jYWxsYmFjaygnQ291bGQgbm90IGxvYWQgQmx1ZXByaW50JylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgY2xlYW51cDogZnVuY3Rpb24oc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpIHtcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcbiAgICAgICAgLy9kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdLnJlbW92ZUNoaWxkKHNjcmlwdFRhZykgLy8gVE9ETzogQ2xlYW51cFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgbm9kZToge1xuICAgICAgLy8gU3R1YiBmb3Igbm9kZS5qcyBIVFRQIGxvYWRpbmcgc3VwcG9ydC5cbiAgICB9LFxuXG4gIH0sXG59XG5cbmV4cG9ydGVyKCdodHRwJywgaHR0cExvYWRlcikgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nLmRlYnVnKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuXG4gICAgICAvLyBUT0RPOiBTd2l0Y2ggdG8gYXN5bmMgZmlsZSBsb2FkaW5nLCBpbXByb3ZlIHJlcXVpcmUoKSwgcGFzcyBpbiBJSUZFIHRvIHNhbmRib3gsIHVzZSBJSUZFIHJlc29sdmVyIGZvciBjYWxsYmFja1xuICAgICAgLy8gVE9ETzogQWRkIGVycm9yIHJlcG9ydGluZy5cblxuICAgICAgY29uc3Qgdm0gPSByZXF1aXJlKCd2bScpXG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlRmlsZShmaWxlUGF0aClcbiAgICAgIGlmICghZmlsZSlcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdCbHVlcHJpbnQgbm90IGZvdW5kJylcblxuICAgICAgY29uc3QgZmlsZUNvbnRlbnRzID0gZnMucmVhZEZpbGVTeW5jKGZpbGUpLnRvU3RyaW5nKClcblxuICAgICAgLy8gVE9ETzogQ3JlYXRlIGEgbW9yZSBjb21wbGV0ZSBzYW5kYm94IG9iamVjdFxuICAgICAgY29uc3Qgc2FuZGJveCA9IHtcbiAgICAgICAgQmx1ZXByaW50OiBudWxsLFxuICAgICAgICByZXF1aXJlOiBmdW5jdGlvbihtb2R1bGVGaWxlKSB7IHJldHVybiByZXF1aXJlKGZpbGVQYXRoICsgJy9ub2RlX21vZHVsZXMvJyArIG1vZHVsZUZpbGUpIH0sXG4gICAgICAgIGNvbnNvbGU6IHsgbG9nOiBsb2csIGVycm9yOiBsb2cuZXJyb3IsIHdhcm46IGxvZy53YXJuLCBpbmZvOiBsb2cuaW5mbyB9LFxuICAgICAgICBnbG9iYWw6IGdsb2JhbCxcbiAgICAgICAgbW9kdWxlOiBtb2R1bGUsXG4gICAgICAgIF9fZGlybmFtZTogZmlsZVBhdGgsXG4gICAgICB9XG5cbiAgICAgIHZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIHZtLnJ1bkluQ29udGV4dChmaWxlQ29udGVudHMsIHNhbmRib3gpXG4gICAgICBjYWxsYmFjayhudWxsLCBzYW5kYm94LkJsdWVwcmludClcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdibHVlcHJpbnRzLycsIGZpbGVOYW1lKVxuICAgIH0sXG5cbiAgICByZXNvbHZlRmlsZTogZnVuY3Rpb24oZmlsZVBhdGgpIHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuXG4gICAgICAvLyBJZiBmaWxlIG9yIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAvLyBDaGVjayBpZiBibHVlcHJpbnQgaXMgYSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgaWYgKGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAgIHJldHVybiBwYXRoLnJlc29sdmUoZmlsZVBhdGgsICdpbmRleC5qcycpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgfVxuXG4gICAgICAvLyBUcnkgYWRkaW5nIGFuIGV4dGVuc2lvbiB0byBzZWUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCBmaWxlID0gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZSkpXG4gICAgICAgIHJldHVybiBmaWxlXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2cuZGVidWcoJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2cuZXJyb3IoJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZy5kZWJ1ZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBWYWxpZGF0ZSBCbHVlcHJpbnQgaW5wdXQgd2l0aCBvcHRpb25hbCBwcm9wZXJ0eSBkZXN0cnVjdHVyaW5nICh1c2luZyBkZXNjcmliZSBvYmplY3QpXG4gICAgICBibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUgPSBoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBjb25zdCBibHVlcHJpbnRCYXNlID0gT2JqZWN0LmNyZWF0ZShCbHVlcHJpbnRCYXNlKVxuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnRCYXNlLCBCbHVlcHJpbnRCYXNlKVxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYmx1ZXByaW50LCAnRnJhbWUnLCB7IHZhbHVlOiBibHVlcHJpbnRCYXNlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHdyaXRhYmxlOiBmYWxzZSB9KSAvLyBUT0RPOiBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZVxuICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IG5hbWVcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpIHtcbiAgLy8gQ3JlYXRlIGJsdWVwcmludCBmcm9tIGNvbnN0cnVjdG9yXG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICAgIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICAgIGNvbnN0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgbG9nLmRlYnVnKCdjb25zdHJ1Y3RvciBjYWxsZWQgZm9yJywgbmFtZSlcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciIsImhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUiXSwibWFwcGluZ3MiOiI7OztFQUVBLFNBQVMsR0FBRyxHQUFHO0VBQ2Y7RUFDQSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDcEMsQ0FBQzs7RUFFRCxHQUFHLENBQUMsS0FBSyxHQUFHLFdBQVc7RUFDdkI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDdEMsRUFBQzs7RUFFRCxHQUFHLENBQUMsSUFBSSxHQUFHLFdBQVc7RUFDdEI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDckMsRUFBQzs7RUFFRCxHQUFHLENBQUMsS0FBSyxHQUFHLFdBQVc7RUFDdkIsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VDbkJEO0VBQ0E7RUFDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO0VBQzdCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLEtBQUssUUFBUTtFQUN0RSxJQUFJLE1BQU0sQ0FBQyxPQUFPLEdBQUcsSUFBRzs7RUFFeEI7RUFDQSxFQUFFLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtFQUNoQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHOztFQUV0QjtFQUNBLE9BQU8sSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksTUFBTSxDQUFDLEdBQUc7RUFDckQsSUFBSSxNQUFNLENBQUMsQ0FBQyxTQUFTLENBQUMsRUFBRSxTQUFTLEdBQUcsRUFBRTtFQUN0QyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHO0VBQ3JCLEtBQUssRUFBQzs7RUFFTjtFQUNBLE9BQU8sSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRO0VBQ3JDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUc7RUFDdEIsQ0FBQzs7RUNsQkQ7RUFDQSxTQUFTLFlBQVksQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFO0VBQ3RDLEVBQUUsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLEVBQUU7RUFDakUsSUFBSSxJQUFJLFlBQVksS0FBSyxNQUFNO0VBQy9CLE1BQU0sUUFBUTs7RUFFZCxJQUFJLElBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssUUFBUTtFQUNoRCxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7RUFDN0MsUUFBUSxNQUFNLENBQUMsWUFBWSxDQUFDLEdBQUcsR0FBRTtFQUNqQztFQUNBLFFBQVEsTUFBTSxDQUFDLFlBQVksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsRUFBQztFQUMxSDtFQUNBLE1BQU0sTUFBTSxDQUFDLGNBQWM7RUFDM0IsUUFBUSxNQUFNO0VBQ2QsUUFBUSxZQUFZO0VBQ3BCLFFBQVEsTUFBTSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUM7RUFDN0QsUUFBTztFQUNQLEdBQUc7O0VBRUgsRUFBRSxPQUFPLE1BQU07RUFDZixDQUFDOztFQUVELFNBQVMsYUFBYSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFO0VBQ3BELEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsVUFBVSxFQUFFO0VBQzVDLElBQUksVUFBVSxFQUFFLEtBQUs7RUFDckIsSUFBSSxRQUFRLEVBQUUsS0FBSztFQUNuQixJQUFJLFlBQVksRUFBRSxJQUFJO0VBQ3RCLElBQUksS0FBSyxFQUFFLFdBQVc7RUFDdEIsTUFBTSxPQUFPLENBQUMsS0FBSyxJQUFJLFVBQVUsR0FBRyxLQUFLLEdBQUcsR0FBRyxHQUFHLHNCQUFzQjtFQUN4RSxLQUFLO0VBQ0wsR0FBRyxFQUFDOztFQUVKLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFO0VBQ3hDLElBQUksVUFBVSxFQUFFLEtBQUs7RUFDckIsSUFBSSxRQUFRLEVBQUUsS0FBSztFQUNuQixJQUFJLFlBQVksRUFBRSxDQUFDLFlBQVksSUFBSSxJQUFJLEdBQUcsS0FBSztFQUMvQyxJQUFJLEtBQUssRUFBRSxLQUFLO0VBQ2hCLEdBQUcsRUFBQztFQUNKLENBQUM7O0VBRUQ7RUFDQSxTQUFTLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUU7RUFDekMsRUFBRSxNQUFNLE1BQU0sR0FBRyxHQUFFOztFQUVuQjtFQUNBLEVBQUUsSUFBSSxDQUFDLE1BQU07RUFDYixJQUFJLE1BQU0sR0FBRyxHQUFFOztFQUVmO0VBQ0EsRUFBRSxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRTtFQUMxQixJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFFO0VBQ3BCLEdBQUc7O0VBRUg7RUFDQSxFQUFFLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUN6QyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFFOztFQUVwQjtFQUNBLElBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7RUFDckUsTUFBTSxRQUFROztFQUVkO0VBQ0E7O0VBRUEsSUFBSSxNQUFNLFNBQVMsR0FBRyxHQUFFO0VBQ3hCLElBQUksS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFO0VBQ2pELE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFDO0VBQ3BFLEtBQUs7O0VBRUwsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsVUFBUztFQUMzQixHQUFHOztFQUVILEVBQUUsT0FBTyxNQUFNO0VBQ2YsQ0FBQzs7RUFFRCxTQUFTLFdBQVcsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFO0VBQ3BDLEVBQUUsTUFBTSxXQUFXLEdBQUcsQ0FBQyxDQUFDLEtBQUssSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUM7O0VBRXZELEVBQUUsSUFBSSxDQUFDLE1BQU07RUFDYixJQUFJLE9BQU8sV0FBVzs7RUFFdEIsRUFBRSxNQUFNLFdBQVcsR0FBRyxHQUFFO0VBQ3hCLEVBQUUsSUFBSSxTQUFTLEdBQUcsRUFBQzs7RUFFbkI7RUFDQSxFQUFFLEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxFQUFFO0VBQ25DLElBQUksV0FBVyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxXQUFXLENBQUMsU0FBUyxFQUFDO0VBQ3pELElBQUksU0FBUyxHQUFFO0VBQ2YsR0FBRzs7RUFFSDtFQUNBLEVBQUUsSUFBSSxTQUFTLEtBQUssQ0FBQztFQUNyQixJQUFJLE9BQU8sS0FBSzs7RUFFaEI7RUFDQSxFQUFFLE9BQU8sV0FBVztFQUNwQixDQUFDOztFQzdGRCxTQUFTLFdBQVcsR0FBRzs7SUFFckIsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWM7TUFDM0IsTUFBTTs7O0lBR1IsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQztNQUM3QixNQUFNOzs7SUFHUixJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7TUFDeEIsTUFBTTtJQUlSLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLEtBQUk7OztJQUdoQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsRUFBQzs7O0lBRzNELElBQUksQ0FBQyxHQUFHLEVBQUM7SUFDVCxLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFO01BQ25DLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxPQUFNOztNQUU3QixJQUFJLElBQUksQ0FBQyxTQUFTLEtBQUssTUFBTSxFQUFFO1FBQzdCLElBQUksT0FBTyxTQUFTLENBQUMsRUFBRSxLQUFLLFVBQVU7VUFDcEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFDLElBQUksR0FBRyw2QkFBNkIsQ0FBQzs7O1FBR2xGLElBQUksU0FBUyxJQUFJLFNBQVMsQ0FBQyxLQUFLO1VBQzlCLFNBQVMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsRUFBQzs7O1FBR2hELElBQUksQ0FBQyxPQUFPLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBQztRQUNsRCxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFDOztPQUU3QixNQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsS0FBSyxJQUFJLEVBQUU7UUFDbEMsSUFBSSxPQUFPLFNBQVMsQ0FBQyxFQUFFLEtBQUssVUFBVTtVQUNwQyxNQUFNLElBQUksS0FBSyxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUMsSUFBSSxHQUFHLDRCQUE0QixDQUFDOztRQUVqRixJQUFJLENBQUMsT0FBTyxHQUFHLGFBQWEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUM7UUFDbEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQztRQUMxQixDQUFDLEdBQUU7T0FDSjtLQUNGOztJQUVELFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFDO0dBQ3JCOztFQUVELFNBQVMsYUFBYSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFO0lBQy9DLE9BQU87TUFDTCxJQUFJLEVBQUUsU0FBUyxDQUFDLElBQUk7TUFDcEIsS0FBSyxFQUFFLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSztNQUM1QixHQUFHLEVBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQztNQUN0QyxLQUFLLEVBQUUsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQztLQUMzQztHQUNGOztFQUVELFNBQVMsVUFBVSxHQUFHOztJQUVwQixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUU7TUFDM0IsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFDO01BQ3JDLE9BQU8sS0FBSztLQUNiOzs7SUFHRCxJQUFJLFVBQVUsR0FBRyxLQUFJO0lBQ3JCLEtBQUssTUFBTSxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUU7TUFDbkMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE9BQU07OztNQUcxQixJQUFJLE1BQU0sQ0FBQyxJQUFJO1FBQ2IsUUFBUTs7TUFFVixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUU7UUFDeEIsVUFBVSxHQUFHLE1BQUs7UUFDbEIsUUFBUTtPQUNUOztNQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRTtRQUM3QixhQUFhLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFDO1FBQ2xELFVBQVUsR0FBRyxNQUFLO1FBQ2xCLFFBQVE7T0FDVDtLQUNGOztJQUVELE9BQU8sVUFBVTtHQUNsQjs7RUFFRCxTQUFTLFNBQVMsR0FBRzs7SUFHbkIsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRTtNQUNyQyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsT0FBTTtNQUM5QixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUM7OztNQUlwRSxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO1FBQzNELENBQTBGO1dBQ3ZGLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLGNBQWM7UUFDdEMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUM7S0FDMUM7R0FDRjs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxRQUFRLEVBQUU7SUFDL0IsTUFBTSxTQUFTLEdBQUcsS0FBSTs7SUFFdEIsSUFBSTtNQUNGLElBQUksS0FBSyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLEdBQUU7OztNQUc5RCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUk7UUFDakIsU0FBUyxDQUFDLElBQUksR0FBRyxTQUFTLENBQUMsRUFBRSxJQUFJLEVBQUU7VUFDakMsSUFBSSxHQUFFO1VBQ1A7O01BRUgsS0FBSyxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFDO01BQ3pELFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsU0FBUyxHQUFHLEVBQUU7UUFDbEQsSUFBSSxHQUFHO1VBQ0wsT0FBTyxHQUFHLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxHQUFHLFNBQVMsQ0FBQyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsQ0FBQzs7OztRQUtyRixTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxHQUFFO1FBQzFCLFNBQVMsQ0FBQyxLQUFLLENBQUMsV0FBVyxHQUFHLEtBQUk7UUFDbEMsU0FBUyxDQUFDLEtBQUssQ0FBQyxZQUFZLEdBQUcsTUFBSztRQUNwQyxVQUFVLENBQUMsV0FBVyxFQUFFLFFBQVEsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBQyxFQUFFLEVBQUUsQ0FBQyxFQUFDO09BQ25FLEVBQUM7O0tBRUgsQ0FBQyxPQUFPLEdBQUcsRUFBRTtNQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQyxJQUFJLEdBQUcsNEJBQTRCLEdBQUcsR0FBRyxDQUFDO0tBQ3RGO0dBQ0Y7OztFQ3JJRCxNQUFNLGdCQUFnQixHQUFHO0lBQ3ZCLEVBQUUsRUFBRSxTQUFTLE1BQU0sRUFBRTtNQUNuQixPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7S0FDeEU7O0lBRUQsSUFBSSxFQUFFLFNBQVMsTUFBTSxFQUFFO01BQ3JCLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUMxRTs7SUFFRCxHQUFHLEVBQUUsU0FBUyxLQUFLLEVBQUUsSUFBSSxFQUFFO01BRXpCLEtBQUssQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsRUFBQztLQUMzQzs7SUFFRCxLQUFLLEVBQUUsU0FBUyxLQUFLLEVBQUUsR0FBRyxFQUFFO01BQzFCLEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLEdBQUcsU0FBUyxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUM7TUFDNUQsS0FBSyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUM7S0FDcEM7O0lBRUQsSUFBSSxLQUFLLEdBQUc7O01BRVYsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1FBQ2IsT0FBTyxFQUFFOztNQUVYLE1BQU0sU0FBUyxHQUFHLEtBQUk7TUFDdEIsTUFBTSxlQUFlLEdBQUcsSUFBSSxPQUFPLENBQUMsU0FBUyxPQUFPLEVBQUUsTUFBTSxFQUFFO1FBQzVELFNBQVMsQ0FBQyxLQUFLLENBQUMsVUFBVSxHQUFHLEtBQUk7UUFDakMsU0FBUyxDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLEdBQUU7T0FDL0QsRUFBQztNQUNGLE9BQU8sZUFBZTtLQUN2Qjs7O0lBR0Y7OztFQUdELFNBQVMsYUFBYSxDQUFDLE1BQU0sRUFBRTtJQUM3QixNQUFNLFNBQVMsR0FBRyxHQUFFO0lBQ3BCLFlBQVksQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUM7O0lBRXpDLFNBQVMsQ0FBQyxJQUFJLEdBQUcsS0FBSTtJQUNyQixTQUFTLENBQUMsS0FBSyxHQUFHO01BQ2hCLE9BQU8sRUFBRSxFQUFFO01BQ1gsUUFBUSxFQUFFLEVBQUU7TUFDYjs7SUFFRCxJQUFJLE9BQU8sTUFBTSxLQUFLLFVBQVUsRUFBRTtNQUNoQyxhQUFhLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBQztNQUNwQyxTQUFTLENBQUMsRUFBRSxHQUFHLE9BQU07TUFDckIsU0FBUyxDQUFDLEVBQUUsR0FBRyxPQUFNO0tBQ3RCLE1BQU07TUFDTCxhQUFhLENBQUMsU0FBUyxFQUFFLFdBQVcsRUFBQztNQUNyQyxTQUFTLENBQUMsRUFBRSxHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7UUFFekMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUM7UUFDakI7TUFDRCxTQUFTLENBQUMsRUFBRSxHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7UUFFekMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUM7UUFDakI7S0FDRjs7SUFFRCxPQUFPLFNBQVM7R0FDakI7O0VBRUQsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFO0lBQzdDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFJO0lBQ3RCLFlBQVksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBQztJQUM1QyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFVLENBQUMsV0FBVztNQUNyRCxPQUFPLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksRUFBQztNQUNyQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUM7S0FDNUIsRUFBRSxJQUFJLEVBQUM7R0FDVDs7RUFFRCxTQUFTLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRTtJQUNwQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLO01BQ3hCLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLEdBQUU7OztJQUc1QixJQUFJLGFBQWEsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFNO0lBQ2hELFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVzs7TUFFL0MsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFDO0tBQzVCLEVBQUUsQ0FBQyxDQUFDLEVBQUM7R0FDUDs7RUFFRCxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDbkIsT0FBTyxXQUFXO01BQ2hCLE9BQU8sRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDO0tBQ2pDO0dBQ0Y7OztFQUdELFNBQVMsT0FBTyxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFO0lBQzFDLElBQUksQ0FBQyxJQUFJO01BQ1AsTUFBTSxJQUFJLEtBQUssQ0FBQyxvRkFBb0YsQ0FBQzs7SUFFdkcsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUs7TUFDbEMsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQzs7SUFFOUQsSUFBSSxDQUFDLE1BQU07TUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLEdBQUcsR0FBRyxTQUFTLEdBQUcsd0NBQXdDLENBQUM7O0lBRS9GLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsS0FBSyxVQUFVLEVBQUU7TUFDbkUsTUFBTSxHQUFHLGFBQWEsQ0FBQyxNQUFNLEVBQUM7S0FDL0IsTUFBTSxJQUFJLE9BQU8sTUFBTSxLQUFLLFVBQVUsRUFBRTtNQUN2QyxNQUFNLEdBQUcsYUFBYSxDQUFDLE1BQU0sRUFBQztLQUMvQjs7O0lBR0QsSUFBSSxTQUFTLEdBQUcsS0FBSTtJQUNwQixJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUU7TUFFN0IsU0FBUyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUM7TUFDM0QsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFLO01BQ3hDLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUk7S0FDaEM7SUFHRCxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFDOztJQUVwRixRQUFRLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUM7SUFDbkMsT0FBTyxTQUFTO0dBQ2pCOztFQUVELFNBQVMsUUFBUSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFOztJQUdsQyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUk7SUFDNUIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBQzs7SUFFeEIsSUFBSSxHQUFHLEVBQUU7TUFDUCxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07UUFDdkIsT0FBTyxNQUE2Qjs7TUFFdEMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxPQUFPLEVBQUU7UUFDaEMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEdBQUcsS0FBSTtRQUMvQixJQUFJLEdBQUcsSUFBRztPQUNYLE1BQU07UUFDTCxLQUFLLEdBQUU7UUFDUCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUM7T0FDdkM7S0FDRjs7O0lBR0QsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7TUFDekIsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsTUFBSzs7TUFFakMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtRQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ2hDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxHQUFHLE1BQUs7T0FDOUI7OztNQUdELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBTztNQUNsQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ3RCLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFO1VBQzVCLElBQUksU0FBUyxHQUFHLE1BQU0sQ0FBQyxPQUFNO1VBRTdCLEtBQUssQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsRUFBQztTQUM1QztPQUNGOztNQUVELE9BQU8sTUFBb0Q7S0FDNUQ7O0lBRUQsUUFBUSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUM7R0FDckI7O0VBRUQsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRTtJQUM1QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsT0FBTTtJQUM3QixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUM7SUFDbkUsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQU87SUFDNUIsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFDO0lBQ2pHLE1BQU0sT0FBTyxHQUFHLE9BQU8sU0FBUTs7O0lBRy9CLElBQUksT0FBTyxLQUFLLFdBQVc7TUFDekIsTUFBTTs7SUFFUixJQUFJLE9BQU8sS0FBSyxRQUFRLElBQUksUUFBUSxZQUFZLE9BQU8sRUFBRTs7TUFFdkQsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUM7S0FDaEQsTUFBTSxJQUFJLE9BQU8sS0FBSyxRQUFRLElBQUksUUFBUSxZQUFZLEtBQUssRUFBRTs7TUFFNUQsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUM7S0FDeEIsTUFBTTs7TUFFTCxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBQztLQUN0QjtHQUNGOztFQUVELFNBQVMsWUFBWSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUU7SUFDL0IsSUFBSSxHQUFHO01BQ0wsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQzs7SUFFeEIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQztHQUN0Qjs7RUM5TEQ7RUFDQSxNQUFNLGFBQWEsR0FBRztFQUN0QixFQUFFLElBQUksRUFBRSxFQUFFO0VBQ1YsRUFBRSxRQUFRLEVBQUUsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQztFQUNqQyxFQUFFLEtBQUssRUFBRSxFQUFFO0VBQ1gsRUFBRSxLQUFLLEVBQUUsRUFBRTs7RUFFWCxFQUFFLE1BQU0sRUFBRSxLQUFLO0VBQ2YsRUFBRSxXQUFXLEVBQUUsS0FBSztFQUNwQixFQUFFLGNBQWMsRUFBRSxLQUFLO0VBQ3ZCLEVBQUUsUUFBUSxFQUFFLEtBQUs7O0VBRWpCLEVBQUUsUUFBUSxFQUFFLEVBQUU7RUFDZCxFQUFFLEtBQUssRUFBRSxFQUFFO0VBQ1gsRUFBRSxPQUFPLEVBQUUsRUFBRTs7RUFFYixFQUFFLEtBQUssRUFBRSxFQUFFO0VBQ1gsRUFBRSxNQUFNLEVBQUUsRUFBRTtFQUNaLEVBQUUsSUFBSSxFQUFFLEVBQUU7O0VBRVYsRUFBRSxVQUFVLEVBQUUsS0FBSztFQUNuQixFQUFFLE9BQU8sRUFBRSxFQUFFO0VBQ2IsQ0FBQzs7RUNsQ0Q7RUFDQSxTQUFTLFdBQVcsQ0FBQyxTQUFTLEVBQUU7RUFDaEMsRUFBRSxJQUFJLE9BQU8sU0FBUyxLQUFLLFVBQVUsRUFBRTtFQUN2QyxJQUFJLE9BQU8sRUFBRSxJQUFJLEVBQUUsU0FBUyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFO0VBQ3ZELEdBQUcsTUFBTSxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVE7RUFDMUMsSUFBSSxTQUFTLEdBQUcsR0FBRTs7RUFFbEI7RUFDQSxFQUFFLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFDO0VBQ3pDLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFDOztFQUVsQztFQUNBLEVBQUUsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO0VBQ3pDO0VBQ0EsSUFBSSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFVBQVU7RUFDekMsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFFO0VBQ2xFLFNBQVMsSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUM1RSxNQUFNLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxHQUFHLEVBQUM7RUFDbkMsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsR0FBRTtFQUNwRSxNQUFNLEtBQUssTUFBTSxVQUFVLElBQUksU0FBUyxFQUFFO0VBQzFDLFFBQVEsSUFBSSxPQUFPLFVBQVUsS0FBSyxVQUFVO0VBQzVDLFVBQVUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxVQUFVLEVBQUUsRUFBQztFQUNyRCxPQUFPO0VBQ1AsS0FBSyxNQUFNLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUU7RUFDcEUsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxHQUFFO0VBQzVGLEtBQUssTUFBTTtFQUNYLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUU7RUFDaEUsS0FBSztFQUNMLEdBQUc7O0VBRUg7RUFDQSxFQUFFLFNBQVMsYUFBYSxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUU7RUFDckM7RUFDQTtFQUNBLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUM7RUFDcEIsTUFBTSxPQUFPLElBQUk7O0VBRWpCLElBQUksSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUU7RUFDbkUsTUFBTSxPQUFPLElBQUk7RUFDakIsS0FBSyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFO0VBQ3pFLE1BQU0sSUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssQ0FBQztFQUM1RCxRQUFRLE9BQU8sS0FBSzs7RUFFcEIsTUFBTSxPQUFPLElBQUk7RUFDakIsS0FBSyxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ3pELE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEtBQUssVUFBVSxFQUFFO0VBQ3JELFFBQVEsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztFQUN6QyxPQUFPO0VBQ1AsS0FBSzs7RUFFTCxJQUFJLE9BQU8sS0FBSztFQUNoQixHQUFHOztFQUVIO0VBQ0EsRUFBRSxPQUFPLFNBQVMsY0FBYyxDQUFDLGFBQWEsRUFBRTtFQUNoRCxJQUFJLE1BQU0sUUFBUSxHQUFHLEdBQUU7RUFDdkIsSUFBSSxNQUFNLEdBQUcsR0FBRyxjQUFhOztFQUU3QixJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLGFBQWEsQ0FBQyxFQUFFO0VBQ2pFLE1BQU0sTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLHdCQUF3QixDQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUM7O0VBRWhGO0VBQ0EsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxZQUFZLEVBQUU7RUFDcEUsUUFBUSxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsY0FBYyxFQUFDO0VBQ3ZELFFBQVEsUUFBUTtFQUNoQixPQUFPOztFQUVQO0VBQ0EsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0VBQ3hCLFFBQVEsTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLGNBQWMsRUFBQztFQUN2RCxRQUFRLFFBQVE7RUFDaEIsT0FBTzs7RUFFUCxNQUFNLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxhQUFhLENBQUMsR0FBRyxFQUFDO0VBQ3hDLE1BQU0sTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFO0VBQ3RDLFFBQVEsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVO0VBQzdDLFFBQVEsWUFBWSxFQUFFLGNBQWMsQ0FBQyxZQUFZO0VBQ2pELFFBQVEsR0FBRyxFQUFFLFdBQVc7RUFDeEIsVUFBVSxPQUFPLFFBQVEsQ0FBQyxHQUFHLENBQUM7RUFDOUIsU0FBUzs7RUFFVCxRQUFRLEdBQUcsRUFBRSxTQUFTLEtBQUssRUFBRTtFQUM3QixVQUFVLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFO0VBQzFDLFlBQVksSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFO0VBQ3JDLGNBQWMsS0FBSyxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssR0FBRyxPQUFPLE1BQUs7RUFDeEUsY0FBYyxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsV0FBVyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDOUcsYUFBYSxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUU7RUFDeEQsY0FBYyxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsa0JBQWtCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQzdILGFBQWE7RUFDYixjQUFjLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLEdBQUcsR0FBRyxhQUFhLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksR0FBRyxVQUFVLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQ3ZILFdBQVc7O0VBRVgsVUFBVSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsTUFBSztFQUMvQixVQUFVLE9BQU8sS0FBSztFQUN0QixTQUFTO0VBQ1QsT0FBTyxFQUFDOztFQUVSO0VBQ0EsTUFBTSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUM1RCxRQUFRLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQztFQUNwQixVQUFVLFFBQVE7O0VBRWxCLFFBQVEsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxHQUFHLEVBQUM7RUFDMUMsUUFBUSxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUU7RUFDeEMsVUFBVSxVQUFVLEVBQUUsY0FBYyxDQUFDLFVBQVU7RUFDL0MsVUFBVSxZQUFZLEVBQUUsY0FBYyxDQUFDLFlBQVk7RUFDbkQsVUFBVSxHQUFHLEVBQUUsV0FBVztFQUMxQixZQUFZLE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQztFQUNoQyxXQUFXOztFQUVYLFVBQVUsR0FBRyxFQUFFLFNBQVMsS0FBSyxFQUFFO0VBQy9CLFlBQVksSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUU7RUFDNUMsY0FBYyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUU7RUFDdkMsZ0JBQWdCLEtBQUssR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEdBQUcsT0FBTyxNQUFLO0VBQzFFLGdCQUFnQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsV0FBVyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDaEgsZUFBZSxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUU7RUFDMUQsZ0JBQWdCLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLEdBQUcsR0FBRyxrQkFBa0IsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBRyxPQUFPLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDL0gsZUFBZTtFQUNmLGdCQUFnQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsYUFBYSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLE9BQU8sS0FBSyxHQUFHLEdBQUcsQ0FBQztFQUN6SCxhQUFhOztFQUViLFlBQVksUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQUs7RUFDakMsWUFBWSxPQUFPLEtBQUs7RUFDeEIsV0FBVztFQUNYLFNBQVMsRUFBQztFQUNWLE9BQU87O0VBRVAsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsYUFBYSxDQUFDLEdBQUcsRUFBQztFQUNuQyxLQUFLOztFQUVMLElBQUksT0FBTyxHQUFHO0VBQ2QsR0FBRztFQUNILENBQUM7O0VBRUQsV0FBVyxDQUFDLGNBQWMsR0FBRyxXQUFXLENBQUMsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0VBQ3RFLEVBQUUsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRO0VBQzdCLElBQUksT0FBTyxLQUFLOztFQUVoQixFQUFFLE9BQU8sR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDO0VBQzlCLENBQUMsQ0FBQzs7RUN6SUY7RUFDQSxNQUFNLGVBQWUsR0FBRyxJQUFJLFdBQVcsQ0FBQztFQUN4QyxFQUFFLElBQUksRUFBRSxXQUFXLENBQUMsY0FBYzs7RUFFbEM7RUFDQSxFQUFFLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNsQixFQUFFLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNoQixFQUFFLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNoQixFQUFFLFFBQVEsRUFBRSxDQUFDLE1BQU0sQ0FBQzs7RUFFcEI7RUFDQSxFQUFFLEdBQUcsRUFBRSxRQUFRO0VBQ2YsRUFBRSxLQUFLLEVBQUUsUUFBUTtFQUNqQixFQUFFLEtBQUssRUFBRSxDQUFDLFFBQVEsQ0FBQzs7RUFFbkI7RUFDQSxFQUFFLEVBQUUsRUFBRSxRQUFRO0VBQ2QsRUFBRSxJQUFJLEVBQUUsUUFBUTs7RUFFaEIsRUFBRSxLQUFLLEVBQUUsUUFBUTtFQUNqQixDQUFDLENBQUM7O0VDeEJGOztFQUVBLFNBQVMsTUFBTSxDQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFFO0VBQ3BEO0VBQ0EsRUFBRSxJQUFJLENBQUMsWUFBWTtFQUNuQixJQUFJLFVBQVUsR0FBRyxVQUFVLENBQUMsSUFBSSxJQUFJLEdBQUU7O0VBRXRDLEVBQUUsSUFBSSxNQUFNLEdBQUc7RUFDZixJQUFJLFFBQVEsRUFBRSxVQUFVO0VBQ3hCLElBQUksT0FBTyxFQUFFLEVBQUU7RUFDZixJQUFJLFNBQVMsRUFBRSxJQUFJO0VBQ25CLElBQUksT0FBTyxFQUFFLEVBQUU7O0VBRWYsSUFBSSxPQUFPLEVBQUUsU0FBUyxHQUFHLEVBQUUsUUFBUSxFQUFFO0VBQ3JDLE1BQU0sSUFBSSxTQUFROztFQUVsQixNQUFNLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtFQUNwQyxRQUFRLFFBQVEsR0FBRyxJQUFHO0VBQ3RCLE9BQU8sTUFBTSxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7RUFDN0MsUUFBUSxRQUFRLEdBQUcsR0FBRyxDQUFDO0VBQ3ZCLE9BQU8sTUFBTTtFQUNiLFFBQVEsUUFBUSxHQUFHLGtCQUFrQixHQUFHLElBQUc7RUFDM0MsT0FBTzs7RUFFUCxNQUFNLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUM7RUFDM0YsS0FBSztFQUNMLElBQUc7O0VBRUgsRUFBRSxJQUFJLENBQUMsUUFBUTtFQUNmLElBQUksT0FBTyxNQUFNOztFQUVqQixFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLFNBQVMsT0FBTyxFQUFFO0VBQ3RELElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7RUFDM0IsSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBQztFQUMxQyxJQUFHOztFQUVILEVBQUUsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLEdBQUcsVUFBVSxHQUFHLDRCQUE0QjtFQUMvRSxFQUFFLHFDQUFxQztFQUN2QyxFQUFFLHNDQUFzQztFQUN4QyxFQUFFLHNFQUFzRTtFQUN4RSxFQUFFLGtDQUFrQztFQUNwQyxFQUFFLGtDQUFrQztFQUNwQyxFQUFFLHFDQUFxQztFQUN2QyxFQUFFLDZCQUE2Qjs7RUFFL0IsRUFBRSxpQkFBaUI7RUFDbkIsRUFBRSxpQkFBaUI7RUFDbkIsSUFBSSxZQUFZLEdBQUcsSUFBSTtFQUN2QixFQUFFLDRCQUE0QjtFQUM5QixFQUFFLHdDQUF3QztFQUMxQyxFQUFFLDJCQUEyQjtFQUM3QixFQUFFLGNBQWE7O0VBRWYsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07RUFDeEIsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07RUFDeEIsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07O0VBRXhCLEVBQUUsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsUUFBTzs7RUFFakMsRUFBRSxPQUFPLE1BQU07RUFDZixDQUFDOzs7RUN2REQsTUFBTSxVQUFVLEdBQUc7SUFDakIsSUFBSSxFQUFFLGNBQWM7SUFDcEIsUUFBUSxFQUFFLFFBQVE7OztJQUdsQixNQUFNLEVBQUUsSUFBSTtJQUNaLFNBQVMsRUFBRSxFQUFFOztJQUViLE1BQU0sRUFBRTtNQUNOLElBQUksRUFBRSxhQUFhO01BQ25CLFFBQVEsRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDOztNQUVyQyxJQUFJLEVBQUUsV0FBVztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsQ0FBQyxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksSUFBSSxHQUFHLE1BQUs7T0FDN0Q7O01BRUQsRUFBRSxFQUFFLFNBQVMsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsaUJBQWlCLEVBQUU7UUFDeEQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTO1VBQ2pCLE9BQU8sUUFBUSxDQUFDLDREQUE0RCxDQUFDOztRQUUvRSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQztPQUMzRTs7TUFFRCxpQkFBaUIsRUFBRSxTQUFTLFFBQVEsRUFBRTtRQUNwQyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztVQUMvQixPQUFPLFFBQVE7O1FBRWpCLE1BQU0sSUFBSSxHQUFHLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLEVBQUUsRUFBQztRQUN2RSxNQUFNLFFBQVEsR0FBRyxhQUFhLEdBQUcsS0FBSTtRQUNyQyxPQUFPLFFBQVE7T0FDaEI7O01BRUQsT0FBTyxFQUFFO1FBQ1AsSUFBSSxFQUFFLFNBQVMsUUFBUSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsRUFBRTtVQUNwRCxNQUFNLFFBQVEsR0FBRyxDQUFDLENBQUMsaUJBQWlCLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxHQUFHLFNBQVE7O1VBR25GLElBQUksT0FBTyxHQUFHLEtBQUk7VUFDbEIsSUFBSSxRQUFRLEdBQUcsS0FBSTtVQUNuQixJQUFJLENBQUMsUUFBUSxFQUFFO1lBQ2IsT0FBTyxHQUFHLE1BQUs7WUFDZixRQUFRLEdBQUcsU0FBUyxHQUFHLEVBQUUsSUFBSSxFQUFFO2NBQzdCLElBQUksR0FBRztnQkFDTCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQzs7Y0FFdEIsT0FBTyxRQUFRLEdBQUcsSUFBSTtjQUN2QjtXQUNGOztVQUVELE1BQU0sYUFBYSxHQUFHLElBQUksY0FBYyxHQUFFOzs7O1VBSTFDLE1BQU0sWUFBWSxHQUFHLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUM7VUFDNUUsYUFBYSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUMsTUFBTSxFQUFDO1VBQzNELGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLE9BQU8sRUFBQzs7VUFFN0QsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBQztVQUM1QyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQzs7VUFFeEIsT0FBTyxRQUFRO1NBQ2hCOztRQUVELFlBQVksRUFBRSxTQUFTLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFO1VBQ2pELElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUTtVQUN4QixJQUFJLENBQUMsUUFBUSxHQUFHLFNBQVE7VUFDeEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBQztVQUN0RCxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFDO1NBQ3pEOztRQUVELE1BQU0sRUFBRSxTQUFTLE1BQU0sRUFBRTtVQUN2QixNQUFNLFlBQVksR0FBRyxLQUFJO1VBQ3pCLE9BQU8sV0FBVztZQUNoQixNQUFNLGFBQWEsR0FBRyxLQUFJOztZQUUxQixJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsR0FBRztjQUM1QixPQUFPLFlBQVksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsVUFBVSxDQUFDOztZQUUzRSxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDLFdBQVcsRUFBRSxhQUFhLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQyxRQUFRLEVBQUM7O1lBRTFHLElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQyxnQkFBZTtZQUNuQyxJQUFJLFNBQVMsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBQztZQUNoRCxTQUFTLENBQUMsV0FBVyxHQUFHLGNBQWE7O1lBRXJDLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFDO1lBQzNCLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxZQUFZLEVBQUM7V0FDaEQ7U0FDRjs7UUFFRCxPQUFPLEVBQUUsU0FBUyxNQUFNLEVBQUU7VUFDeEIsTUFBTSxZQUFZLEdBQUcsS0FBSTtVQUN6QixNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsU0FBUTs7VUFFdEMsT0FBTyxXQUFXO1lBQ2hCLE1BQU0sU0FBUyxHQUFHLEtBQUk7WUFDdEIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLFlBQVksRUFBQzs7OztZQUkvQyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtjQUN6RSxHQUFHLENBQUMsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLFFBQVEsR0FBRyxXQUFXLEVBQUM7Y0FDdEUsT0FBTyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBRSxZQUFZLENBQUMsUUFBUSxDQUFDO2FBQzdFOztZQUVELFlBQVksQ0FBQyxRQUFRLENBQUMsMEJBQTBCLEVBQUM7V0FDbEQ7U0FDRjs7UUFFRCxPQUFPLEVBQUUsU0FBUyxTQUFTLEVBQUUsWUFBWSxFQUFFO1VBQ3pDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBQztVQUMxRCxTQUFTLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQyxPQUFPLEVBQUM7O1NBRTdEO09BQ0Y7O01BRUQsSUFBSSxFQUFFOztPQUVMOztLQUVGO0lBQ0Y7O0VBRUQsUUFBUSxDQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUM7OztFQzVINUIsTUFBTSxVQUFVLEdBQUc7SUFDakIsSUFBSSxFQUFFLGNBQWM7SUFDcEIsUUFBUSxFQUFFLE9BQU87OztJQUdqQixNQUFNLEVBQUUsSUFBSTtJQUNaLFNBQVMsRUFBRSxFQUFFOztJQUViLE1BQU0sRUFBRTtNQUNOLElBQUksRUFBRSxhQUFhO01BQ25CLFFBQVEsRUFBRSxNQUFNOztNQUVoQixJQUFJLEVBQUUsV0FBVztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsQ0FBQyxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksSUFBSSxHQUFHLE1BQUs7T0FDN0Q7O01BRUQsRUFBRSxFQUFFLFNBQVMsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7UUFDckMsSUFBSSxJQUFJLENBQUMsU0FBUztVQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDZFQUE2RSxDQUFDOzs7OztRQU9oRyxNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ3hCLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLEVBQUM7O1FBRXhCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUM7O1FBRWpELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFDO1FBQ3ZDLElBQUksQ0FBQyxJQUFJO1VBQ1AsT0FBTyxRQUFRLENBQUMscUJBQXFCLENBQUM7O1FBRXhDLE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxHQUFFOzs7UUFHckQsTUFBTSxPQUFPLEdBQUc7VUFDZCxTQUFTLEVBQUUsSUFBSTtVQUNmLE9BQU8sRUFBRSxTQUFTLFVBQVUsRUFBRSxFQUFFLE9BQU8sT0FBTyxDQUFDLFFBQVEsR0FBRyxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsRUFBRTtVQUMxRixPQUFPLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFO1VBQ3ZFLE1BQU0sRUFBRSxNQUFNO1VBQ2QsTUFBTSxFQUFFLE1BQU07VUFDZCxTQUFTLEVBQUUsUUFBUTtVQUNwQjs7UUFFRCxFQUFFLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBQztRQUN6QixFQUFFLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxPQUFPLEVBQUM7UUFDdEMsUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFDO09BQ2xDOztNQUVELGlCQUFpQixFQUFFLFNBQVMsUUFBUSxFQUFFO1FBQ3BDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUM7UUFDNUIsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFDO09BQzVEOztNQUVELFdBQVcsRUFBRSxTQUFTLFFBQVEsRUFBRTtRQUM5QixNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUM7OztRQUc1QixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLEVBQUU7O1VBRTNCLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxXQUFXLEVBQUU7WUFDckMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUM7O1lBRXpDLE9BQU8sUUFBUSxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDO1NBQ3BFOzs7UUFHRCxNQUFNLElBQUksR0FBRyxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssR0FBRyxFQUFFLEVBQUM7UUFDdkUsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztVQUNyQixPQUFPLElBQUk7O1FBRWIsT0FBTyxLQUFLO09BQ2I7S0FDRjtHQUNGOztFQ2hGRDtBQUNBOztFQUtBLE1BQU0sT0FBTyxHQUFHO0lBQ2QsY0FBYyxFQUFFLFVBQVU7SUFDMUIsY0FBYyxFQUFFLFVBQVU7SUFDM0I7O0VBRUQsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFOztJQUUzQixPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7R0FDakM7O0VBRUQsU0FBUyxlQUFlLENBQUMsSUFBSSxFQUFFO0lBQzdCLE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBQztJQUM5QyxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFDOztJQUVwQyxPQUFPO01BQ0wsSUFBSSxFQUFFLElBQUk7TUFDVixJQUFJLEVBQUUsSUFBSTtNQUNWLElBQUksRUFBRSxrQkFBa0I7TUFDeEIsUUFBUSxFQUFFLFFBQVE7S0FDbkI7R0FDRjs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7O0lBRTNCLElBQUksQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUTtNQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDOztJQUVsRCxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFDOzs7SUFHakUsSUFBSSxDQUFDLFlBQVk7TUFDZixPQUFPLENBQUMsT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLE1BQU0sR0FBRyxNQUFNOztJQUV2RCxPQUFPLFlBQVksQ0FBQyxDQUFDLENBQUM7R0FDdkI7O0VBRUQsU0FBUyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUU7SUFDbEMsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO01BQ3ZDLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFDO0tBQ3hCOztJQUVELE1BQU0sQ0FBQyxTQUFTLEdBQUcsR0FBRTtHQUN0Qjs7RUFFRCxNQUFNLE9BQU8sR0FBRyxTQUFTLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO0lBQzdDLElBQUk7TUFDRixNQUFNLFFBQVEsR0FBRyxlQUFlLENBQUMsSUFBSSxFQUFDO01BQ3RDLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxLQUFJO01BQzlCLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxTQUFROzs7TUFLbEMsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDO1FBQ25CLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU07VUFDMUIsT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQzs7VUFFekMsT0FBTyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7O01BRXJELE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRztRQUNsQixRQUFRLEVBQUUsUUFBUTtRQUNsQixRQUFRLEVBQUUsUUFBUTtRQUNsQixNQUFNLEVBQUUsS0FBSztRQUNiLFNBQVMsRUFBRSxDQUFDLFFBQVEsQ0FBQztRQUN0Qjs7Ozs7TUFLRCxNQUFNLE1BQU0sR0FBRyxVQUFVLEdBQUcsU0FBUTtNQUNwQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksR0FBRTtNQUM3QixPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFNBQVMsR0FBRyxFQUFFLFVBQVUsQ0FBQztRQUNqRSxJQUFJLEdBQUc7VUFDTCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFDO2FBQ2hDOztVQUdILElBQUksQ0FBQyxVQUFVLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUTtZQUMvQyxNQUFNLElBQUksS0FBSyxDQUFDLHdFQUF3RSxDQUFDOztVQUUzRixJQUFJLE9BQU8sVUFBVSxDQUFDLElBQUksS0FBSyxRQUFRO1lBQ3JDLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUM7O1VBRXJFLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUM7VUFDaEMsSUFBSSxDQUFDLE1BQU07WUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDOzs7VUFHL0MsSUFBSSxNQUFNLENBQUMsTUFBTTtZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLFVBQVUsQ0FBQyxJQUFJLEdBQUcsbUJBQW1CLENBQUM7O1VBRXhFLE1BQU0sQ0FBQyxNQUFNLEdBQUcsV0FBVTtVQUMxQixNQUFNLENBQUMsTUFBTSxHQUFHLEtBQUk7O1VBRXBCLGtCQUFrQixDQUFDLE1BQU0sRUFBQztTQUMzQjtPQUNGLEVBQUM7Ozs7S0FJSCxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsQ0FBQztLQUNyRTtHQUNGOzs7RUNqR0QsTUFBTSxVQUFVLEdBQUcsR0FBRTtFQUNyQixTQUFTLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQ3pCLElBQUksRUFBRSxJQUFJLFlBQVksS0FBSyxDQUFDO01BQzFCLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQzs7SUFFOUIsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRO01BQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxHQUFHLG9CQUFvQixDQUFDOzs7SUFHcEUsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDO01BQ2xCLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQzs7SUFFekIsSUFBSSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsSUFBSSxFQUFDO0lBQ25DLE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsYUFBYSxFQUFFO01BQzFDLElBQUk7O1FBSUYsSUFBSSxPQUFPLGFBQWEsS0FBSyxRQUFRO1VBQ25DLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELENBQUM7OztRQUduRUEsWUFBb0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxFQUFDOzs7UUFHOUNDLGFBQXFCLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFDO1FBQzNELFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLGFBQWEsQ0FBQyxLQUFJOzs7UUFHekMsU0FBUyxHQUFHLGVBQWUsQ0FBQyxTQUFTLEVBQUM7OztRQUd0QyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsR0FBR0MsaUJBQXlCLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUSxFQUFDOztRQUVoRyxTQUFTLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFJO1FBQzdCLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBQzs7O1FBR25DLElBQUksU0FBUyxDQUFDLFNBQVM7VUFDckIsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFTOztPQUV6QyxDQUFDLE9BQU8sR0FBRyxFQUFFO1FBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxHQUFHLG9CQUFvQixHQUFHLEdBQUcsQ0FBQztPQUNwRTtLQUNGLEVBQUM7O0lBRUYsT0FBTyxTQUFTO0dBQ2pCOztFQUVELFNBQVMsU0FBUyxDQUFDLElBQUksRUFBRTtJQUN2QixNQUFNLFNBQVMsR0FBRyxJQUFJLG9CQUFvQixDQUFDLElBQUksRUFBQztJQUNoREQsYUFBcUIsQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBQzs7O0lBR25ERCxZQUFvQixDQUFDLFNBQVMsRUFBRSxnQkFBZ0IsRUFBQzs7O0lBR2pELE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFDO0lBQ2xEQSxZQUFvQixDQUFDLGFBQWEsRUFBRSxhQUFhLEVBQUM7SUFDbEQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFDO0lBQzFILFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLEtBQUk7O0lBRTNCLE9BQU8sU0FBUztHQUNqQjs7RUFFRCxTQUFTLG9CQUFvQixDQUFDLElBQUksRUFBRTs7SUFFbEMsT0FBTyxXQUFXOztNQUVoQixJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUM7UUFDbEIsT0FBTyxVQUFVLENBQUMsSUFBSSxDQUFDOztNQUV6QixNQUFNLFNBQVMsR0FBRyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUM7TUFDakMsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsVUFBUzs7TUFJakMsT0FBTyxTQUFTO0tBQ2pCO0dBQ0Y7OztBQUdEQyxlQUFxQixDQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7QUFDM0NBLGVBQXFCLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUM7OztFQUdqRCxRQUFRLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQzs7OzsifQ==
