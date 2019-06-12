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

    // Put this blueprint at the beginning of the flow, that way any .from events trigger the worker first.
    this.Frame.pipes.unshift({ direction: 'to', target: this });

    // Break out event pipes and flow pipes into separate arrays.
    let i = 1; // Start at 1, since our worker blueprint instance should be 0
    for (const pipe of this.Frame.pipes) {
      const blueprint = pipe.target;

      if (pipe.direction === 'from') {
        if (typeof blueprint.on !== 'function')
          throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')

        // Used when target blueprint is part of another flow
        if (blueprint && blueprint.Frame)
          blueprint.Frame.parents.push({ target: this }); // TODO: Check if worker blueprint is already added.

        // .from(Events) start the flow at index 0 (worker blueprint)
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
      state: blueprint.Frame.state || {},
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
          return void 0

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

    let retValue;
    let retType;
    try {
      retValue = blueprint.in.call(context, data, props, new factory(pipeCallback).bind(context));
      retType = typeof retValue;
    } catch (err) {
      retValue = err;
      retType = 'error';
    }

    // Blueprint.in does not return anything
    if (!retValue || retType === 'undefined')
      return

    if (retType === 'object' && retValue instanceof Promise) {
      // Handle promises
      retValue.then(context.out).catch(context.error);
    } else if (retType === 'error' ||
               retType === 'object' && retValue instanceof Error ||
               retType === 'object' && retValue.constructor.name === 'Error') {
      // Handle errors
      context.error(retValue);
    } else {
      // Handle regular primitives and objects
      context.out(retValue);
    }
  }

  function factory(fn) {
    return function() {
      return fn.apply(this, arguments)
    }
  }

  function pipeCallback(err, data) {
    if (err)
      return this.error(err)

    return this.out(data)
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
      queue$1(nextPipe, this, [index, null, data]);
    },

    error: function(index, err) {
      queue$1(nextPipe, this, [index, err]);
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
  function debounce(func, wait, blueprint, args) {
    const name = func.name;
    clearTimeout(blueprint.Frame.debounce[name]);
    blueprint.Frame.debounce[name] = setTimeout(function() {
      delete blueprint.Frame.debounce[name];
      func.apply(blueprint, args);
    }, wait);
  }

  function queue$1(func, blueprint, args) {
    // Queue array is primarily for IDE.
    let queuePosition = blueprint.Frame.queue.length;
    blueprint.Frame.queue.push(setTimeout(function() {
      // TODO: Cleanup queue
      func.apply(blueprint, args);
    }, 1));
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
          ;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL0JsdWVwcmludFN0dWIuanMiLCIuLi9saWIvZmxvdy5qcyIsIi4uL2xpYi9tZXRob2RzLmpzIiwiLi4vbGliL0JsdWVwcmludEJhc2UuanMiLCIuLi9saWIvT2JqZWN0TW9kZWwuanMiLCIuLi9saWIvc2NoZW1hLmpzIiwiLi4vbGliL01vZHVsZUxvYWRlci5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUuanMiLCIuLi9saWIvbG9hZGVyLmpzIiwiLi4vbGliL0ZyYW1lLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0J1xuXG5mdW5jdGlvbiBsb2coKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUuZXJyb3IuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cud2FybiA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLndhcm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZGVidWcgPSBmdW5jdGlvbigpIHtcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5leHBvcnQgZGVmYXVsdCBsb2dcbiIsIi8vIFVuaXZlcnNhbCBleHBvcnQgZnVuY3Rpb24gZGVwZW5kaW5nIG9uIGVudmlyb25tZW50LlxuLy8gQWx0ZXJuYXRpdmVseSwgaWYgdGhpcyBwcm92ZXMgdG8gYmUgaW5lZmZlY3RpdmUsIGRpZmZlcmVudCB0YXJnZXRzIGZvciByb2xsdXAgY291bGQgYmUgY29uc2lkZXJlZC5cbmZ1bmN0aW9uIGV4cG9ydGVyKG5hbWUsIG9iaikge1xuICAvLyBOb2RlLmpzICYgbm9kZS1saWtlIGVudmlyb25tZW50cyAoZXhwb3J0IGFzIG1vZHVsZSlcbiAgaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyA9PT0gJ29iamVjdCcpXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBvYmpcblxuICAvLyBHbG9iYWwgZXhwb3J0IChhbHNvIGFwcGxpZWQgdG8gTm9kZSArIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMpXG4gIGlmICh0eXBlb2YgZ2xvYmFsID09PSAnb2JqZWN0JylcbiAgICBnbG9iYWxbbmFtZV0gPSBvYmpcblxuICAvLyBVTURcbiAgZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKVxuICAgIGRlZmluZShbJ2V4cG9ydHMnXSwgZnVuY3Rpb24oZXhwKSB7XG4gICAgICBleHBbbmFtZV0gPSBvYmpcbiAgICB9KVxuXG4gIC8vIEJyb3dzZXJzIGFuZCBicm93c2VyLWxpa2UgZW52aXJvbm1lbnRzIChFbGVjdHJvbiwgSHlicmlkIHdlYiBhcHBzLCBldGMpXG4gIGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKVxuICAgIHdpbmRvd1tuYW1lXSA9IG9ialxufVxuXG5leHBvcnQgZGVmYXVsdCBleHBvcnRlclxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIE9iamVjdCBoZWxwZXIgZnVuY3Rpb25zXG5mdW5jdGlvbiBhc3NpZ25PYmplY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0sIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICBlbHNlXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICAgIHRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lLFxuICAgICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHNvdXJjZSwgcHJvcGVydHlOYW1lKVxuICAgICAgKVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBzZXREZXNjcmlwdG9yKHRhcmdldCwgdmFsdWUsIGNvbmZpZ3VyYWJsZSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAndG9TdHJpbmcnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gKHZhbHVlKSA/ICdbRnJhbWU6ICcgKyB2YWx1ZSArICddJyA6ICdbRnJhbWU6IENvbnN0cnVjdG9yXSdcbiAgICB9LFxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICduYW1lJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IChjb25maWd1cmFibGUpID8gdHJ1ZSA6IGZhbHNlLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgfSlcbn1cblxuLy8gRGVzdHJ1Y3R1cmUgdXNlciBpbnB1dCBmb3IgcGFyYW1ldGVyIGRlc3RydWN0dXJpbmcgaW50byAncHJvcHMnIG9iamVjdC5cbmZ1bmN0aW9uIGNyZWF0ZURlc3RydWN0dXJlKHNvdXJjZSwga2V5cykge1xuICBjb25zdCB0YXJnZXQgPSB7fVxuXG4gIC8vIElmIG5vIHRhcmdldCBleGlzdCwgc3R1YiB0aGVtIHNvIHdlIGRvbid0IHJ1biBpbnRvIGlzc3VlcyBsYXRlci5cbiAgaWYgKCFzb3VyY2UpXG4gICAgc291cmNlID0ge31cblxuICAvLyBDcmVhdGUgc3R1YnMgZm9yIEFycmF5IG9mIGtleXMuIEV4YW1wbGU6IFsnaW5pdCcsICdpbicsIGV0Y11cbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIHRhcmdldFtrZXldID0gW11cbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBzb3VyY2UncyBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNvdXJjZSkpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG5cbiAgICAvLyBXZSBvbmx5IHN1cHBvcnQgb2JqZWN0cyBmb3Igbm93LiBFeGFtcGxlIHsgaW5pdDogeyAnc29tZUtleSc6ICdzb21lRGVzY3JpcHRpb24nIH19XG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShzb3VyY2Vba2V5XSkpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gVE9ETzogU3VwcG9ydCBhcnJheXMgZm9yIHR5cGUgY2hlY2tpbmdcbiAgICAvLyBFeGFtcGxlOiB7IGluaXQ6ICdzb21lS2V5JzogWydzb21lIGRlc2NyaXB0aW9uJywgJ3N0cmluZyddIH1cblxuICAgIGNvbnN0IHByb3BJbmRleCA9IFtdXG4gICAgZm9yIChjb25zdCBwcm9wIG9mIE9iamVjdC5rZXlzKHNvdXJjZVtrZXldKSkge1xuICAgICAgcHJvcEluZGV4LnB1c2goeyBuYW1lOiBwcm9wLCBkZXNjcmlwdGlvbjogc291cmNlW2tleV1bcHJvcF0gfSlcbiAgICB9XG5cbiAgICB0YXJnZXRba2V5XSA9IHByb3BJbmRleFxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBkZXN0cnVjdHVyZSh0YXJnZXQsIHByb3BzKSB7XG4gIGNvbnN0IHNvdXJjZVByb3BzID0gKCFwcm9wcykgPyBbXSA6IEFycmF5LmZyb20ocHJvcHMpXG5cbiAgaWYgKCF0YXJnZXQpXG4gICAgcmV0dXJuIHNvdXJjZVByb3BzXG5cbiAgY29uc3QgdGFyZ2V0UHJvcHMgPSB7fVxuICBsZXQgcHJvcEluZGV4ID0gMFxuXG4gIC8vIExvb3AgdGhyb3VnaCBvdXIgdGFyZ2V0IGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGNvbnN0IHRhcmdldFByb3Agb2YgdGFyZ2V0KSB7XG4gICAgdGFyZ2V0UHJvcHNbdGFyZ2V0UHJvcC5uYW1lXSA9IHNvdXJjZVByb3BzW3Byb3BJbmRleF1cbiAgICBwcm9wSW5kZXgrK1xuICB9XG5cbiAgLy8gSWYgd2UgZG9uJ3QgaGF2ZSBhIHZhbGlkIHRhcmdldDsgcmV0dXJuIHByb3BzIGFycmF5IGluc3RlYWQuIEV4YW1wbGU6IFsncHJvcDEnLCAncHJvcDInXVxuICBpZiAocHJvcEluZGV4ID09PSAwKVxuICAgIHJldHVybiBwcm9wc1xuXG4gIC8vIEV4YW1wbGU6IHsgc29tZUtleTogc29tZVZhbHVlLCBzb21lT3RoZXJLZXk6IHNvbWVPdGhlclZhbHVlIH1cbiAgcmV0dXJuIHRhcmdldFByb3BzXG59XG5cbmV4cG9ydCB7XG4gIGFzc2lnbk9iamVjdCxcbiAgc2V0RGVzY3JpcHRvcixcbiAgY3JlYXRlRGVzdHJ1Y3R1cmUsXG4gIGRlc3RydWN0dXJlXG59XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IHsgQmx1ZXByaW50TWV0aG9kcyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGFzc2lnbk9iamVjdCwgc2V0RGVzY3JpcHRvciB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gQmx1ZXByaW50U3R1Yih0YXJnZXQpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0ge31cbiAgYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICBibHVlcHJpbnQuc3R1YiA9IHRydWVcbiAgYmx1ZXByaW50LkZyYW1lID0ge1xuICAgIHBhcmVudHM6IFtdLFxuICAgIGRlc2NyaWJlOiBbXSxcbiAgfVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdGdW5jdGlvbicpXG4gICAgYmx1ZXByaW50LmluID0gdGFyZ2V0XG4gICAgYmx1ZXByaW50Lm9uID0gdGFyZ2V0XG4gIH0gZWxzZSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdQcmltaXRpdmUnKVxuICAgIGJsdWVwcmludC5pbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5pbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICAgIGJsdWVwcmludC5vbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5vbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTdHViXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCB7IGRlc3RydWN0dXJlIH0gZnJvbSAnLi9oZWxwZXJzJ1xuXG5mdW5jdGlvbiBwcm9jZXNzRmxvdygpIHtcbiAgLy8gQWxyZWFkeSBwcm9jZXNzaW5nIHRoaXMgQmx1ZXByaW50J3MgZmxvdy5cbiAgaWYgKHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cpXG4gICAgcmV0dXJuXG5cbiAgLy8gSWYgbm8gcGlwZXMgZm9yIGZsb3csIHRoZW4gbm90aGluZyB0byBkby5cbiAgaWYgKHRoaXMuRnJhbWUucGlwZXMubGVuZ3RoIDwgMSlcbiAgICByZXR1cm5cblxuICAvLyBDaGVjayB0aGF0IGFsbCBibHVlcHJpbnRzIGFyZSByZWFkeVxuICBpZiAoIWZsb3dzUmVhZHkuY2FsbCh0aGlzKSlcbiAgICByZXR1cm5cblxuICBsb2cuZGVidWcoJ1Byb2Nlc3NpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcbiAgbG9nLmRlYnVnKClcbiAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IHRydWVcblxuICAvLyBQdXQgdGhpcyBibHVlcHJpbnQgYXQgdGhlIGJlZ2lubmluZyBvZiB0aGUgZmxvdywgdGhhdCB3YXkgYW55IC5mcm9tIGV2ZW50cyB0cmlnZ2VyIHRoZSB3b3JrZXIgZmlyc3QuXG4gIHRoaXMuRnJhbWUucGlwZXMudW5zaGlmdCh7IGRpcmVjdGlvbjogJ3RvJywgdGFyZ2V0OiB0aGlzIH0pXG5cbiAgLy8gQnJlYWsgb3V0IGV2ZW50IHBpcGVzIGFuZCBmbG93IHBpcGVzIGludG8gc2VwYXJhdGUgYXJyYXlzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgICBpZiAoYmx1ZXByaW50ICYmIGJsdWVwcmludC5GcmFtZSlcbiAgICAgICAgYmx1ZXByaW50LkZyYW1lLnBhcmVudHMucHVzaCh7IHRhcmdldDogdGhpcyB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMCAod29ya2VyIGJsdWVwcmludClcbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIDApXG4gICAgICB0aGlzLkZyYW1lLmV2ZW50cy5wdXNoKHBpcGUpXG5cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5pbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGlucHV0LicpXG5cbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIGkpXG4gICAgICB0aGlzLkZyYW1lLmZsb3cucHVzaChwaXBlKVxuICAgICAgaSsrXG4gICAgfVxuICB9XG5cbiAgc3RhcnRGbG93LmNhbGwodGhpcylcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29udGV4dCh3b3JrZXIsIGJsdWVwcmludCwgaW5kZXgpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBibHVlcHJpbnQubmFtZSxcbiAgICBzdGF0ZTogYmx1ZXByaW50LkZyYW1lLnN0YXRlIHx8IHt9LFxuICAgIG91dDogYmx1ZXByaW50Lm91dC5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICAgIGVycm9yOiBibHVlcHJpbnQuZXJyb3IuYmluZCh3b3JrZXIsIGluZGV4KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICBsZXQgZmxvd3NSZWFkeSA9IHRydWVcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuXG4gICAgLy8gTm90IGEgYmx1ZXByaW50LCBlaXRoZXIgYSBmdW5jdGlvbiBvciBwcmltaXRpdmVcbiAgICBpZiAodGFyZ2V0LnN0dWIpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUubG9hZGVkKSB7XG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZsb3dzUmVhZHlcbn1cblxuZnVuY3Rpb24gc3RhcnRGbG93KCkge1xuICBsb2cuZGVidWcoJ1N0YXJ0aW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG5cbiAgZm9yIChjb25zdCBldmVudCBvZiB0aGlzLkZyYW1lLmV2ZW50cykge1xuICAgIGNvbnN0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG4gICAgbG9nLmRlYnVnKGJsdWVwcmludC5uYW1lLCAncHJvcHMnLCBwcm9wcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgZG9uZSkge1xuICAgICAgICBkb25lKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6aW5nID0gZmFsc2VcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KSB9LCAxKVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmZ1bmN0aW9uIG5leHRQaXBlKGluZGV4LCBlcnIsIGRhdGEpIHtcbiAgbG9nLmRlYnVnKCduZXh0OicsIGluZGV4KVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgaWYgKGVycikge1xuICAgIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpXG4gICAgICByZXR1cm4gbG9nLmRlYnVnKCdObyBlcnJvciBoYW5kbGVyJylcblxuICAgIGlmIChuZXh0LnRhcmdldC5uYW1lID09PSAnRXJyb3InKSB7XG4gICAgICBuZXh0LmNvbnRleHQuaGFuZGxlRXJyb3IgPSB0cnVlXG4gICAgICBkYXRhID0gZXJyXG4gICAgfSBlbHNlIHtcbiAgICAgIGluZGV4KytcbiAgICAgIHJldHVybiBuZXh0UGlwZS5jYWxsKHRoaXMsIGluZGV4LCBlcnIpXG4gICAgfVxuICB9XG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuXG4gIGxldCByZXRWYWx1ZVxuICBsZXQgcmV0VHlwZVxuICB0cnkge1xuICAgIHJldFZhbHVlID0gYmx1ZXByaW50LmluLmNhbGwoY29udGV4dCwgZGF0YSwgcHJvcHMsIG5ldyBmYWN0b3J5KHBpcGVDYWxsYmFjaykuYmluZChjb250ZXh0KSlcbiAgICByZXRUeXBlID0gdHlwZW9mIHJldFZhbHVlXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldFZhbHVlID0gZXJyXG4gICAgcmV0VHlwZSA9ICdlcnJvcidcbiAgfVxuXG4gIC8vIEJsdWVwcmludC5pbiBkb2VzIG5vdCByZXR1cm4gYW55dGhpbmdcbiAgaWYgKCFyZXRWYWx1ZSB8fCByZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnZXJyb3InIHx8XG4gICAgICAgICAgICAgcmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBFcnJvciB8fFxuICAgICAgICAgICAgIHJldFR5cGUgPT09ICdvYmplY3QnICYmIHJldFZhbHVlLmNvbnN0cnVjdG9yLm5hbWUgPT09ICdFcnJvcicpIHtcbiAgICAvLyBIYW5kbGUgZXJyb3JzXG4gICAgY29udGV4dC5lcnJvcihyZXRWYWx1ZSlcbiAgfSBlbHNlIHtcbiAgICAvLyBIYW5kbGUgcmVndWxhciBwcmltaXRpdmVzIGFuZCBvYmplY3RzXG4gICAgY29udGV4dC5vdXQocmV0VmFsdWUpXG4gIH1cbn1cblxuZnVuY3Rpb24gZmFjdG9yeShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgfVxufVxuXG5mdW5jdGlvbiBwaXBlQ2FsbGJhY2soZXJyLCBkYXRhKSB7XG4gIGlmIChlcnIpXG4gICAgcmV0dXJuIHRoaXMuZXJyb3IoZXJyKVxuXG4gIHJldHVybiB0aGlzLm91dChkYXRhKVxufVxuXG5leHBvcnQgeyBwcm9jZXNzRmxvdywgbmV4dFBpcGUgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgQmx1ZXByaW50U3R1YiBmcm9tICcuL0JsdWVwcmludFN0dWInXG5pbXBvcnQgeyBwcm9jZXNzRmxvdywgbmV4dFBpcGUgfSBmcm9tICcuL2Zsb3cnXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAndG8nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgb3V0OiBmdW5jdGlvbihpbmRleCwgZGF0YSkge1xuICAgIGxvZy5kZWJ1ZygnV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLm91dDonLCBkYXRhLCBhcmd1bWVudHMpXG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgbnVsbCwgZGF0YV0pXG4gIH0sXG5cbiAgZXJyb3I6IGZ1bmN0aW9uKGluZGV4LCBlcnIpIHtcbiAgICBsb2cuZXJyb3IoJ1dvcmtlciAnICsgdGhpcy5uYW1lICsgJy5lcnJvcjonLCBlcnIsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBlcnJdKVxuICB9LFxuXG4gIGdldCB2YWx1ZSgpIHtcbiAgICAvLyBCYWlsIGlmIHdlJ3JlIG5vdCByZWFkeS4gKFVzZWQgdG8gZ2V0IG91dCBvZiBPYmplY3RNb2RlbCBhbmQgYXNzaWduT2JqZWN0IGxpbWJvKVxuICAgIGlmICghdGhpcy5GcmFtZSlcbiAgICAgIHJldHVybiAnJ1xuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2VGb3JWYWx1ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgYmx1ZXByaW50LkZyYW1lLmlzUHJvbWlzZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvbWlzZSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QgfVxuICAgIH0pXG4gICAgcmV0dXJuIHByb21pc2VGb3JWYWx1ZVxuICB9LFxuXG4gIC8vY2F0Y2g6IGZ1bmN0aW9uKGNhbGxiYWNrKXsgLi4uIH1cbn1cblxuLy8gRmxvdyBNZXRob2QgaGVscGVyc1xuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICAvLyBRdWV1ZSBhcnJheSBpcyBwcmltYXJpbHkgZm9yIElERS5cbiAgbGV0IHF1ZXVlUG9zaXRpb24gPSBibHVlcHJpbnQuRnJhbWUucXVldWUubGVuZ3RoXG4gIGJsdWVwcmludC5GcmFtZS5xdWV1ZS5wdXNoKHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgLy8gVE9ETzogQ2xlYW51cCBxdWV1ZVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCAxKSlcbn1cblxuLy8gUGlwZSBjb250cm9sXG5mdW5jdGlvbiBhZGRQaXBlKGRpcmVjdGlvbiwgdGFyZ2V0LCBwYXJhbXMpIHtcbiAgaWYgKCF0aGlzKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG1ldGhvZCBjYWxsZWQgd2l0aG91dCBpbnN0YW5jZSwgZGlkIHlvdSBhc3NpZ24gdGhlIG1ldGhvZCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiB0YXJnZXQudG8gIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH1cblxuICAvLyBFbnN1cmUgd2UncmUgd29ya2luZyBvbiBhIG5ldyBpbnN0YW5jZSBvZiB3b3JrZXIgYmx1ZXByaW50XG4gIGxldCBibHVlcHJpbnQgPSB0aGlzXG4gIGlmICghYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlKSB7XG4gICAgbG9nLmRlYnVnKCdDcmVhdGluZyBuZXcgaW5zdGFuY2UgZm9yJywgYmx1ZXByaW50Lm5hbWUpXG4gICAgYmx1ZXByaW50ID0gYmx1ZXByaW50KEFycmF5LmZyb20oYmx1ZXByaW50LkZyYW1lLnByb3BzKVswXSlcbiAgICBibHVlcHJpbnQuRnJhbWUuc3RhdGUgPSB0aGlzLkZyYW1lLnN0YXRlIC8vIFRPRE86IFNob3VsZCBjcmVhdGUgYSBuZXcgc3RhdGUgb2JqZWN0P1xuICAgIGJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSA9IHRydWVcbiAgfVxuXG4gIGxvZy5kZWJ1ZyhibHVlcHJpbnQubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKTogJyArIHRhcmdldC5uYW1lKVxuICBibHVlcHJpbnQuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuY29uc3QgRmxvd1NjaGVtYSA9IHtcbiAgZGlyZWN0aW9uOiAnJywgLy8gdG8gb3IgZnJvbVxuICB0YXJnZXQ6IG51bGwsXG4gIHBhcmFtczogW10sXG4gIGNvbnRleHQ6IHtcbiAgICBuYW1lOiAnJyxcbiAgICBzdGF0ZToge30sXG4gICAgb3V0OiBmdW5jdGlvbigpe30sXG4gICAgZXJyb3I6IGZ1bmN0aW9uKCl7fSxcbiAgfVxufVxuXG4vLyBJbnRlcm5hbCBGcmFtZSBwcm9wc1xuY29uc3QgQmx1ZXByaW50QmFzZSA9IHtcbiAgbmFtZTogJycsXG4gIGRlc2NyaWJlOiBbJ2luaXQnLCAnaW4nLCAnb3V0J10sIC8vIFRPRE86IENoYW5nZSB0byBvYmplY3QgYW5kIG1ha2Ugc2VwYXJhdGUgc2NoZW1hLiB7IGluaXQ6IHsgbmFtZTogJycsIGRlc2NyaXB0aW9uOiAnIH0gfVxuICBwcm9wczoge30sXG4gIHN0YXRlOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgaW5zdGFuY2U6IGZhbHNlLFxuXG4gIGRlYm91bmNlOiB7fSxcbiAgcXVldWU6IFtdLFxuICBwYXJlbnRzOiBbXSxcblxuICBwaXBlczogW10sIC8vW0Zsb3dTY2hlbWFdLFxuICBldmVudHM6IFtdLCAvL1tGbG93U2NoZW1hXSxcbiAgZmxvdzogW10sIC8vW0Zsb3dTY2hlbWFdLFxuXG4gIGlzUHJvbWlzZWQ6IGZhbHNlLFxuICBwcm9taXNlOiB7fSxcbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50QmFzZVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIENvbmNlcHQgYmFzZWQgb246IGh0dHA6Ly9vYmplY3Rtb2RlbC5qcy5vcmcvXG5mdW5jdGlvbiBPYmplY3RNb2RlbChzY2hlbWFPYmopIHtcbiAgaWYgKHR5cGVvZiBzY2hlbWFPYmogPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4geyB0eXBlOiBzY2hlbWFPYmoubmFtZSwgZXhwZWN0czogc2NoZW1hT2JqIH1cbiAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hT2JqICE9PSAnb2JqZWN0JylcbiAgICBzY2hlbWFPYmogPSB7fVxuXG4gIC8vIENsb25lIHNjaGVtYSBvYmplY3Qgc28gd2UgZG9uJ3QgbXV0YXRlIGl0LlxuICBjb25zdCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgY29uc3Qgc2NoZW1hQXJyID0gc2NoZW1hW2tleV1cbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogZmFsc2UsIHR5cGU6ICdvcHRpb25hbCcsIHR5cGVzOiBbXSB9XG4gICAgICBmb3IgKGNvbnN0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBjb25zdCBwcm94eU9iaiA9IHt9XG4gICAgY29uc3Qgb2JqID0gb2JqVG9WYWxpZGF0ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcblxuICB2YWx1ZTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICBsZXQgZmlsZVBhdGhcblxuICAgICAgaWYgKHVybC5pbmRleE9mKCcuLycpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybFxuICAgICAgfSBlbHNlIGlmICh1cmwuaW5kZXhPZignaHR0cCcpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbGVQYXRoID0gJy4uL25vZGVfbW9kdWxlcy8nICsgdXJsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIGZpbGVQYXRoLCBudWxsLCBjYWxsYmFjaywgdHJ1ZSlcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbikge1xuICAgICAgaWYgKCF0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdVUkwgbG9hZGluZyB3aXRoIG5vZGUuanMgbm90IHN1cHBvcnRlZCB5ZXQgKENvbWluZyBzb29uISkuJylcblxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3Nlci5sb2FkLmNhbGwodGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbilcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBjb25zdCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgY29uc3QgZmlsZVBhdGggPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVQYXRoXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaywgc2tpcE5vcm1hbGl6YXRpb24pIHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSAoIXNraXBOb3JtYWxpemF0aW9uKSA/IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpIDogZmlsZU5hbWVcbiAgICAgICAgbG9nLmRlYnVnKCdbaHR0cCBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVQYXRoKVxuXG4gICAgICAgIHZhciBpc0FzeW5jID0gdHJ1ZVxuICAgICAgICB2YXIgc3luY0ZpbGUgPSBudWxsXG4gICAgICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgICAgICBpc0FzeW5jID0gZmFsc2VcbiAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZmlsZSkge1xuICAgICAgICAgICAgaWYgKGVycilcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycilcblxuICAgICAgICAgICAgcmV0dXJuIHN5bmNGaWxlID0gZmlsZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKVxuXG4gICAgICAgIC8vIFRPRE86IE5lZWRzIHZhbGlkYXRpbmcgdGhhdCBldmVudCBoYW5kbGVycyB3b3JrIGFjcm9zcyBicm93c2Vycy4gTW9yZSBzcGVjaWZpY2FsbHksIHRoYXQgdGhleSBydW4gb24gRVM1IGVudmlyb25tZW50cy5cbiAgICAgICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0I0Jyb3dzZXJfY29tcGF0aWJpbGl0eVxuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSBuZXcgdGhpcy5icm93c2VyLnNjcmlwdEV2ZW50cyh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcblxuICAgICAgICBzY3JpcHRSZXF1ZXN0Lm9wZW4oJ0dFVCcsIGZpbGVQYXRoLCBpc0FzeW5jKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LnNlbmQobnVsbClcblxuICAgICAgICByZXR1cm4gc3luY0ZpbGVcbiAgICAgIH0sXG5cbiAgICAgIHNjcmlwdEV2ZW50czogZnVuY3Rpb24obG9hZGVyLCBmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrXG4gICAgICAgIHRoaXMuZmlsZU5hbWUgPSBmaWxlTmFtZVxuICAgICAgICB0aGlzLm9uTG9hZCA9IGxvYWRlci5icm93c2VyLm9uTG9hZC5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgICAgdGhpcy5vbkVycm9yID0gbG9hZGVyLmJyb3dzZXIub25FcnJvci5jYWxsKHRoaXMsIGxvYWRlcilcbiAgICAgIH0sXG5cbiAgICAgIG9uTG9hZDogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFJlcXVlc3QgPSB0aGlzXG5cbiAgICAgICAgICBpZiAoc2NyaXB0UmVxdWVzdC5zdGF0dXMgPiA0MDApXG4gICAgICAgICAgICByZXR1cm4gc2NyaXB0RXZlbnRzLm9uRXJyb3IuY2FsbChzY3JpcHRSZXF1ZXN0LCBzY3JpcHRSZXF1ZXN0LnN0YXR1c1RleHQpXG5cbiAgICAgICAgICBjb25zdCBzY3JpcHRDb250ZW50ID0gTW9kdWxlKHNjcmlwdFJlcXVlc3QucmVzcG9uc2VVUkwsIHNjcmlwdFJlcXVlc3QucmVzcG9uc2VUZXh0LCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG5cbiAgICAgICAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudFxuICAgICAgICAgIHZhciBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKVxuICAgICAgICAgIHNjcmlwdFRhZy50ZXh0Q29udGVudCA9IHNjcmlwdENvbnRlbnRcblxuICAgICAgICAgIGh0bWwuYXBwZW5kQ2hpbGQoc2NyaXB0VGFnKVxuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIG9uRXJyb3I6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIGNvbnN0IGZpbGVOYW1lID0gc2NyaXB0RXZlbnRzLmZpbGVOYW1lXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IHNjcmlwdFRhZyA9IHRoaXNcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuXG4gICAgICAgICAgLy8gVHJ5IHRvIGZhbGxiYWNrIHRvIGluZGV4LmpzXG4gICAgICAgICAgLy8gRklYTUU6IGluc3RlYWQgb2YgZmFsbGluZyBiYWNrLCB0aGlzIHNob3VsZCBiZSB0aGUgZGVmYXVsdCBpZiBubyBgLmpzYCBpcyBkZXRlY3RlZCwgYnV0IFVSTCB1Z2xpZmllcnMgYW5kIHN1Y2ggd2lsbCBoYXZlIGlzc3Vlcy4uIGhybW1tbS4uXG4gICAgICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSAmJiBmaWxlTmFtZS5pbmRleE9mKCdpbmRleC5qcycpID09PSAtMSkge1xuICAgICAgICAgICAgbG9nLndhcm4oJ1todHRwXSBBdHRlbXB0aW5nIHRvIGZhbGxiYWNrIHRvOiAnLCBmaWxlTmFtZSArICcvaW5kZXguanMnKVxuICAgICAgICAgICAgcmV0dXJuIGxvYWRlci5pbi5jYWxsKGxvYWRlciwgZmlsZU5hbWUgKyAnL2luZGV4LmpzJywgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHNjcmlwdEV2ZW50cy5jYWxsYmFjaygnQ291bGQgbm90IGxvYWQgQmx1ZXByaW50JylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgY2xlYW51cDogZnVuY3Rpb24oc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpIHtcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBzY3JpcHRFdmVudHMub25FcnJvcilcbiAgICAgICAgLy9kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdLnJlbW92ZUNoaWxkKHNjcmlwdFRhZykgLy8gVE9ETzogQ2xlYW51cFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgbm9kZToge1xuICAgICAgLy8gU3R1YiBmb3Igbm9kZS5qcyBIVFRQIGxvYWRpbmcgc3VwcG9ydC5cbiAgICB9LFxuXG4gIH0sXG59XG5cbmV4cG9ydGVyKCdodHRwJywgaHR0cExvYWRlcikgLy8gVE9ETzogQ2xlYW51cCwgZXhwb3NlIG1vZHVsZXMgaW5zdGVhZFxuXG5leHBvcnQgZGVmYXVsdCBodHRwTG9hZGVyXG4iLCJpbXBvcnQgbG9nIGZyb20gJy4uLy4uL2xpYi9sb2dnZXInXG5cbi8vIEVtYmVkZGVkIGZpbGUgbG9hZGVyIGJsdWVwcmludC5cbmNvbnN0IGZpbGVMb2FkZXIgPSB7XG4gIG5hbWU6ICdsb2FkZXJzL2ZpbGUnLFxuICBwcm90b2NvbDogJ2VtYmVkJyxcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnRmlsZSBMb2FkZXInLFxuICAgIHByb3RvY29sOiAnZmlsZScsXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZTovLyBsb2FkaW5nIHdpdGhpbiBicm93c2VyIG5vdCBzdXBwb3J0ZWQgeWV0LiBUcnkgcmVsYXRpdmUgVVJMIGluc3RlYWQuJylcblxuICAgICAgbG9nLmRlYnVnKCdbZmlsZSBsb2FkZXJdIExvYWRpbmcgZmlsZTogJyArIGZpbGVOYW1lKVxuXG4gICAgICAvLyBUT0RPOiBTd2l0Y2ggdG8gYXN5bmMgZmlsZSBsb2FkaW5nLCBpbXByb3ZlIHJlcXVpcmUoKSwgcGFzcyBpbiBJSUZFIHRvIHNhbmRib3gsIHVzZSBJSUZFIHJlc29sdmVyIGZvciBjYWxsYmFja1xuICAgICAgLy8gVE9ETzogQWRkIGVycm9yIHJlcG9ydGluZy5cblxuICAgICAgY29uc3Qgdm0gPSByZXF1aXJlKCd2bScpXG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlRmlsZShmaWxlUGF0aClcbiAgICAgIGlmICghZmlsZSlcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCdCbHVlcHJpbnQgbm90IGZvdW5kJylcblxuICAgICAgY29uc3QgZmlsZUNvbnRlbnRzID0gZnMucmVhZEZpbGVTeW5jKGZpbGUpLnRvU3RyaW5nKClcblxuICAgICAgLy8gVE9ETzogQ3JlYXRlIGEgbW9yZSBjb21wbGV0ZSBzYW5kYm94IG9iamVjdFxuICAgICAgY29uc3Qgc2FuZGJveCA9IHtcbiAgICAgICAgQmx1ZXByaW50OiBudWxsLFxuICAgICAgICByZXF1aXJlOiBmdW5jdGlvbihtb2R1bGVGaWxlKSB7IHJldHVybiByZXF1aXJlKGZpbGVQYXRoICsgJy9ub2RlX21vZHVsZXMvJyArIG1vZHVsZUZpbGUpIH0sXG4gICAgICAgIGNvbnNvbGU6IHsgbG9nOiBsb2csIGVycm9yOiBsb2cuZXJyb3IsIHdhcm46IGxvZy53YXJuLCBpbmZvOiBsb2cuaW5mbyB9LFxuICAgICAgICBnbG9iYWw6IGdsb2JhbCxcbiAgICAgICAgbW9kdWxlOiBtb2R1bGUsXG4gICAgICAgIF9fZGlybmFtZTogZmlsZVBhdGgsXG4gICAgICB9XG5cbiAgICAgIHZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIHZtLnJ1bkluQ29udGV4dChmaWxlQ29udGVudHMsIHNhbmRib3gpXG4gICAgICBjYWxsYmFjayhudWxsLCBzYW5kYm94LkJsdWVwcmludClcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdibHVlcHJpbnRzLycsIGZpbGVOYW1lKVxuICAgIH0sXG5cbiAgICByZXNvbHZlRmlsZTogZnVuY3Rpb24oZmlsZVBhdGgpIHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuXG4gICAgICAvLyBJZiBmaWxlIG9yIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGVQYXRoKSkge1xuICAgICAgICAvLyBDaGVjayBpZiBibHVlcHJpbnQgaXMgYSBkaXJlY3RvcnkgZmlyc3RcbiAgICAgICAgaWYgKGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAgIHJldHVybiBwYXRoLnJlc29sdmUoZmlsZVBhdGgsICdpbmRleC5qcycpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgfVxuXG4gICAgICAvLyBUcnkgYWRkaW5nIGFuIGV4dGVuc2lvbiB0byBzZWUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCBmaWxlID0gZmlsZVBhdGggKyAoKGZpbGVQYXRoLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZSkpXG4gICAgICAgIHJldHVybiBmaWxlXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gIH0sXG59XG5cblxuZXhwb3J0IGRlZmF1bHQgZmlsZUxvYWRlclxuIiwiLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGh0dHBMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2h0dHAnXG5pbXBvcnQgZmlsZUxvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvZmlsZSdcblxuLy8gTXVsdGktZW52aXJvbm1lbnQgYXN5bmMgbW9kdWxlIGxvYWRlclxuY29uc3QgbW9kdWxlcyA9IHtcbiAgJ2xvYWRlcnMvaHR0cCc6IGh0dHBMb2FkZXIsXG4gICdsb2FkZXJzL2ZpbGUnOiBmaWxlTG9hZGVyLFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgLy8gVE9ETzogbG9vcCB0aHJvdWdoIGVhY2ggZmlsZSBwYXRoIGFuZCBub3JtYWxpemUgaXQgdG9vOlxuICByZXR1cm4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS8vLmNhcGl0YWxpemUoKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmlsZUluZm8oZmlsZSkge1xuICBjb25zdCBub3JtYWxpemVkRmlsZU5hbWUgPSBub3JtYWxpemVOYW1lKGZpbGUpXG4gIGNvbnN0IHByb3RvY29sID0gcGFyc2VQcm90b2NvbChmaWxlKVxuXG4gIHJldHVybiB7XG4gICAgZmlsZTogZmlsZSxcbiAgICBwYXRoOiBmaWxlLFxuICAgIG5hbWU6IG5vcm1hbGl6ZWRGaWxlTmFtZSxcbiAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQcm90b2NvbChuYW1lKSB7XG4gIC8vIEZJWE1FOiBuYW1lIHNob3VsZCBvZiBiZWVuIG5vcm1hbGl6ZWQgYnkgbm93LiBFaXRoZXIgcmVtb3ZlIHRoaXMgY29kZSBvciBtb3ZlIGl0IHNvbWV3aGVyZSBlbHNlLi5cbiAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbG9hZGVyIGJsdWVwcmludCBuYW1lJylcblxuICB2YXIgcHJvdG9SZXN1bHRzID0gbmFtZS5tYXRjaCgvOlxcL1xcLy9naSkgJiYgbmFtZS5zcGxpdCgvOlxcL1xcLy9naSlcblxuICAvLyBObyBwcm90b2NvbCBmb3VuZCwgaWYgYnJvd3NlciBlbnZpcm9ubWVudCB0aGVuIGlzIHJlbGF0aXZlIFVSTCBlbHNlIGlzIGEgZmlsZSBwYXRoLiAoU2FuZSBkZWZhdWx0cyBidXQgY2FuIGJlIG92ZXJyaWRkZW4pXG4gIGlmICghcHJvdG9SZXN1bHRzKVxuICAgIHJldHVybiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gJ2h0dHAnIDogJ2ZpbGUnXG5cbiAgcmV0dXJuIHByb3RvUmVzdWx0c1swXVxufVxuXG5mdW5jdGlvbiBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKSB7XG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgbW9kdWxlLmNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrKG1vZHVsZS5tb2R1bGUpXG4gIH1cblxuICBtb2R1bGUuY2FsbGJhY2tzID0gW11cbn1cblxuY29uc3QgaW1wb3J0cyA9IGZ1bmN0aW9uKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZUluZm8gPSByZXNvbHZlRmlsZUluZm8obmFtZSlcbiAgICBjb25zdCBmaWxlTmFtZSA9IGZpbGVJbmZvLm5hbWVcbiAgICBjb25zdCBwcm90b2NvbCA9IGZpbGVJbmZvLnByb3RvY29sXG5cbiAgICBsb2cuZGVidWcoJ2xvYWRpbmcgbW9kdWxlOicsIGZpbGVOYW1lKVxuXG4gICAgLy8gTW9kdWxlIGhhcyBsb2FkZWQgb3Igc3RhcnRlZCB0byBsb2FkXG4gICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdKVxuICAgICAgaWYgKG1vZHVsZXNbZmlsZU5hbWVdLmxvYWRlZClcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG1vZHVsZXNbZmlsZU5hbWVdLm1vZHVsZSkgLy8gUmV0dXJuIG1vZHVsZSBmcm9tIENhY2hlXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBtb2R1bGVzW2ZpbGVOYW1lXS5jYWxsYmFja3MucHVzaChjYWxsYmFjaykgLy8gTm90IGxvYWRlZCB5ZXQsIHJlZ2lzdGVyIGNhbGxiYWNrXG5cbiAgICBtb2R1bGVzW2ZpbGVOYW1lXSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcbiAgICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgICAgIGxvYWRlZDogZmFsc2UsXG4gICAgICBjYWxsYmFja3M6IFtjYWxsYmFja10sXG4gICAgfVxuXG4gICAgLy8gQm9vdHN0cmFwcGluZyBsb2FkZXIgYmx1ZXByaW50cyA7KVxuICAgIC8vRnJhbWUoJ0xvYWRlcnMvJyArIHByb3RvY29sKS5mcm9tKGZpbGVOYW1lKS50byhmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKSB7fSlcblxuICAgIGNvbnN0IGxvYWRlciA9ICdsb2FkZXJzLycgKyBwcm90b2NvbFxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW5pdCgpIC8vIFRPRE86IG9wdGlvbmFsIGluaXQgKGluc2lkZSBGcmFtZSBjb3JlKVxuICAgIG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuaW4oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSl7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICBsb2cuZXJyb3IoJ0Vycm9yOiAnLCBlcnIsIGZpbGVOYW1lKVxuICAgICAgZWxzZSB7XG4gICAgICAgIGxvZy5kZWJ1ZygnTG9hZGVkIEJsdWVwcmludCBtb2R1bGU6ICcsIGZpbGVOYW1lKVxuXG4gICAgICAgIGlmICghZXhwb3J0RmlsZSB8fCB0eXBlb2YgZXhwb3J0RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgICBpZiAodHlwZW9mIGV4cG9ydEZpbGUubmFtZSAhPT0gJ3N0cmluZycpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEJsdWVwcmludCBmaWxlLCBCbHVlcHJpbnQgbWlzc2luZyBhIG5hbWUnKVxuXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IG1vZHVsZXNbZmlsZU5hbWVdXG4gICAgICAgIGlmICghbW9kdWxlKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVWggb2gsIHdlIHNob3VsZG50IGJlIGhlcmUnKVxuXG4gICAgICAgIC8vIE1vZHVsZSBhbHJlYWR5IGxvYWRlZC4gTm90IHN1cHBvc2UgdG8gYmUgaGVyZS4gT25seSBmcm9tIGZvcmNlLWxvYWRpbmcgd291bGQgZ2V0IHlvdSBoZXJlLlxuICAgICAgICBpZiAobW9kdWxlLmxvYWRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcIicgKyBleHBvcnRGaWxlLm5hbWUgKyAnXCIgYWxyZWFkeSBsb2FkZWQuJylcblxuICAgICAgICBtb2R1bGUubW9kdWxlID0gZXhwb3J0RmlsZVxuICAgICAgICBtb2R1bGUubG9hZGVkID0gdHJ1ZVxuXG4gICAgICAgIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IG1vZHVsZXNbbG9hZGVyXS5tb2R1bGUuYnVuZGxlIHN1cHBvcnQgZm9yIENMSSB0b29saW5nLlxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGxvYWQgYmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgaW1wb3J0c1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgZXhwb3J0ZXIgZnJvbSAnLi9leHBvcnRzJ1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgQmx1ZXByaW50TWV0aG9kcyBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgeyBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfSBmcm9tICcuL21ldGhvZHMnXG5pbXBvcnQgQmx1ZXByaW50QmFzZSBmcm9tICcuL0JsdWVwcmludEJhc2UnXG5pbXBvcnQgQmx1ZXByaW50U2NoZW1hIGZyb20gJy4vc2NoZW1hJ1xuaW1wb3J0IGltcG9ydHMgZnJvbSAnLi9sb2FkZXInXG5cbi8vIEZyYW1lIGFuZCBCbHVlcHJpbnQgY29uc3RydWN0b3JzXG5jb25zdCBzaW5nbGV0b25zID0ge31cbmZ1bmN0aW9uIEZyYW1lKG5hbWUsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEZyYW1lKSlcbiAgICByZXR1cm4gbmV3IEZyYW1lKG5hbWUsIG9wdHMpXG5cbiAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBuYW1lIFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJylcblxuICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gIGxldCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50KG5hbWUpXG4gIGltcG9ydHMobmFtZSwgb3B0cywgZnVuY3Rpb24oYmx1ZXByaW50RmlsZSkge1xuICAgIHRyeSB7XG5cbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50IGxvYWRlZDonLCBibHVlcHJpbnRGaWxlLm5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50RmlsZSAhPT0gJ29iamVjdCcpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgIC8vIFVwZGF0ZSBmYXV4IGJsdWVwcmludCBzdHViIHdpdGggcmVhbCBtb2R1bGVcbiAgICAgIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgYmx1ZXByaW50RmlsZSlcblxuICAgICAgLy8gVXBkYXRlIGJsdWVwcmludCBuYW1lXG4gICAgICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlLm5hbWUsIGZhbHNlKVxuICAgICAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBibHVlcHJpbnRGaWxlLm5hbWVcblxuICAgICAgLy8gQXBwbHkgYSBzY2hlbWEgdG8gYmx1ZXByaW50XG4gICAgICBibHVlcHJpbnQgPSBCbHVlcHJpbnRTY2hlbWEoYmx1ZXByaW50KVxuXG4gICAgICAvLyBWYWxpZGF0ZSBCbHVlcHJpbnQgaW5wdXQgd2l0aCBvcHRpb25hbCBwcm9wZXJ0eSBkZXN0cnVjdHVyaW5nICh1c2luZyBkZXNjcmliZSBvYmplY3QpXG4gICAgICBibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUgPSBoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlKGJsdWVwcmludC5kZXNjcmliZSwgQmx1ZXByaW50QmFzZS5kZXNjcmliZSlcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLmxvYWRlZCA9IHRydWVcbiAgICAgIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG5cbiAgICAgIC8vIElmIGJsdWVwcmludCBpbnRlbmRzIHRvIGJlIGEgc2luZ2xldG9uLCBhZGQgaXQgdG8gdGhlIGxpc3QuXG4gICAgICBpZiAoYmx1ZXByaW50LnNpbmdsZXRvbilcbiAgICAgICAgc2luZ2xldG9uc1tibHVlcHJpbnQubmFtZV0gPSBibHVlcHJpbnRcblxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nICsgZXJyKVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludChuYW1lKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKVxuICBoZWxwZXJzLnNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnQmx1ZXByaW50JywgdHJ1ZSlcblxuICAvLyBCbHVlcHJpbnQgbWV0aG9kc1xuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgLy8gQ3JlYXRlIGhpZGRlbiBibHVlcHJpbnQuRnJhbWUgcHJvcGVydHkgdG8ga2VlcCBzdGF0ZVxuICBjb25zdCBibHVlcHJpbnRCYXNlID0gT2JqZWN0LmNyZWF0ZShCbHVlcHJpbnRCYXNlKVxuICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnRCYXNlLCBCbHVlcHJpbnRCYXNlKVxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYmx1ZXByaW50LCAnRnJhbWUnLCB7IHZhbHVlOiBibHVlcHJpbnRCYXNlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHdyaXRhYmxlOiBmYWxzZSB9KSAvLyBUT0RPOiBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZVxuICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IG5hbWVcblxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmZ1bmN0aW9uIEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpIHtcbiAgLy8gQ3JlYXRlIGJsdWVwcmludCBmcm9tIGNvbnN0cnVjdG9yXG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgYSBzaW5nbGV0b24gKGZvciBzaGFyZWQgcmVzb3VyY2VzKSwgcmV0dXJuIGl0IGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3IGluc3RhbmNlLlxuICAgIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICAgIGNvbnN0IGJsdWVwcmludCA9IG5ldyBGcmFtZShuYW1lKVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IGFyZ3VtZW50c1xuXG4gICAgbG9nLmRlYnVnKCdjb25zdHJ1Y3RvciBjYWxsZWQgZm9yJywgbmFtZSlcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJxdWV1ZSIsImhlbHBlcnMuYXNzaWduT2JqZWN0IiwiaGVscGVycy5zZXREZXNjcmlwdG9yIiwiaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZSJdLCJtYXBwaW5ncyI6Ijs7O0VBRUEsU0FBUyxHQUFHLEdBQUc7RUFDZjtFQUNBLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQUVELEdBQUcsQ0FBQyxLQUFLLEdBQUcsV0FBVztFQUN2QjtFQUNBLEVBQUUsT0FBTyxD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
