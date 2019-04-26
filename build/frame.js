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
      /*flow: {
        worker: worker.name,
        state: worker.Frame.flowState || {},
      }*/
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

  // TODO: Move nextPipe, callNext, and pipeCallback to flow

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL0JsdWVwcmludFN0dWIuanMiLCIuLi9saWIvZmxvdy5qcyIsIi4uL2xpYi9tZXRob2RzLmpzIiwiLi4vbGliL0JsdWVwcmludEJhc2UuanMiLCIuLi9saWIvT2JqZWN0TW9kZWwuanMiLCIuLi9saWIvc2NoZW1hLmpzIiwiLi4vbGliL01vZHVsZUxvYWRlci5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwLmpzIiwiLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUuanMiLCIuLi9saWIvbG9hZGVyLmpzIiwiLi4vbGliL0ZyYW1lLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0J1xuXG5mdW5jdGlvbiBsb2coKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gIGNvbnNvbGUuZXJyb3IuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cud2FybiA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLndhcm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5sb2cuZGVidWcgPSBmdW5jdGlvbigpIHtcbiAgY29uc29sZS5sb2cuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5leHBvcnQgZGVmYXVsdCBsb2dcbiIsIi8vIFVuaXZlcnNhbCBleHBvcnQgZnVuY3Rpb24gZGVwZW5kaW5nIG9uIGVudmlyb25tZW50LlxuLy8gQWx0ZXJuYXRpdmVseSwgaWYgdGhpcyBwcm92ZXMgdG8gYmUgaW5lZmZlY3RpdmUsIGRpZmZlcmVudCB0YXJnZXRzIGZvciByb2xsdXAgY291bGQgYmUgY29uc2lkZXJlZC5cbmZ1bmN0aW9uIGV4cG9ydGVyKG5hbWUsIG9iaikge1xuICAvLyBOb2RlLmpzICYgbm9kZS1saWtlIGVudmlyb25tZW50cyAoZXhwb3J0IGFzIG1vZHVsZSlcbiAgaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyA9PT0gJ29iamVjdCcpXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBvYmpcblxuICAvLyBHbG9iYWwgZXhwb3J0IChhbHNvIGFwcGxpZWQgdG8gTm9kZSArIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMpXG4gIGlmICh0eXBlb2YgZ2xvYmFsID09PSAnb2JqZWN0JylcbiAgICBnbG9iYWxbbmFtZV0gPSBvYmpcblxuICAvLyBVTURcbiAgZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKVxuICAgIGRlZmluZShbJ2V4cG9ydHMnXSwgZnVuY3Rpb24oZXhwKSB7XG4gICAgICBleHBbbmFtZV0gPSBvYmpcbiAgICB9KVxuXG4gIC8vIEJyb3dzZXJzIGFuZCBicm93c2VyLWxpa2UgZW52aXJvbm1lbnRzIChFbGVjdHJvbiwgSHlicmlkIHdlYiBhcHBzLCBldGMpXG4gIGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKVxuICAgIHdpbmRvd1tuYW1lXSA9IG9ialxufVxuXG5leHBvcnQgZGVmYXVsdCBleHBvcnRlclxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIE9iamVjdCBoZWxwZXIgZnVuY3Rpb25zXG5mdW5jdGlvbiBhc3NpZ25PYmplY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKSkge1xuICAgIGlmIChwcm9wZXJ0eU5hbWUgPT09ICduYW1lJylcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAodHlwZW9mIHNvdXJjZVtwcm9wZXJ0eU5hbWVdID09PSAnb2JqZWN0JylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBbXVxuICAgICAgZWxzZVxuICAgICAgICB0YXJnZXRbcHJvcGVydHlOYW1lXSA9IE9iamVjdC5jcmVhdGUoc291cmNlW3Byb3BlcnR5TmFtZV0sIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKHNvdXJjZVtwcm9wZXJ0eU5hbWVdKSlcbiAgICBlbHNlXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICAgIHRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lLFxuICAgICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHNvdXJjZSwgcHJvcGVydHlOYW1lKVxuICAgICAgKVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBzZXREZXNjcmlwdG9yKHRhcmdldCwgdmFsdWUsIGNvbmZpZ3VyYWJsZSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAndG9TdHJpbmcnLCB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gKHZhbHVlKSA/ICdbRnJhbWU6ICcgKyB2YWx1ZSArICddJyA6ICdbRnJhbWU6IENvbnN0cnVjdG9yXSdcbiAgICB9LFxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsICduYW1lJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IChjb25maWd1cmFibGUpID8gdHJ1ZSA6IGZhbHNlLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgfSlcbn1cblxuLy8gRGVzdHJ1Y3R1cmUgdXNlciBpbnB1dCBmb3IgcGFyYW1ldGVyIGRlc3RydWN0dXJpbmcgaW50byAncHJvcHMnIG9iamVjdC5cbmZ1bmN0aW9uIGNyZWF0ZURlc3RydWN0dXJlKHNvdXJjZSwga2V5cykge1xuICBjb25zdCB0YXJnZXQgPSB7fVxuXG4gIC8vIElmIG5vIHRhcmdldCBleGlzdCwgc3R1YiB0aGVtIHNvIHdlIGRvbid0IHJ1biBpbnRvIGlzc3VlcyBsYXRlci5cbiAgaWYgKCFzb3VyY2UpXG4gICAgc291cmNlID0ge31cblxuICAvLyBDcmVhdGUgc3R1YnMgZm9yIEFycmF5IG9mIGtleXMuIEV4YW1wbGU6IFsnaW5pdCcsICdpbicsIGV0Y11cbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIHRhcmdldFtrZXldID0gW11cbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBzb3VyY2UncyBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNvdXJjZSkpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG5cbiAgICAvLyBXZSBvbmx5IHN1cHBvcnQgb2JqZWN0cyBmb3Igbm93LiBFeGFtcGxlIHsgaW5pdDogeyAnc29tZUtleSc6ICdzb21lRGVzY3JpcHRpb24nIH19XG4gICAgaWYgKHR5cGVvZiBzb3VyY2Vba2V5XSAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShzb3VyY2Vba2V5XSkpXG4gICAgICBjb250aW51ZVxuXG4gICAgLy8gVE9ETzogU3VwcG9ydCBhcnJheXMgZm9yIHR5cGUgY2hlY2tpbmdcbiAgICAvLyBFeGFtcGxlOiB7IGluaXQ6ICdzb21lS2V5JzogWydzb21lIGRlc2NyaXB0aW9uJywgJ3N0cmluZyddIH1cblxuICAgIGNvbnN0IHByb3BJbmRleCA9IFtdXG4gICAgZm9yIChjb25zdCBwcm9wIG9mIE9iamVjdC5rZXlzKHNvdXJjZVtrZXldKSkge1xuICAgICAgcHJvcEluZGV4LnB1c2goeyBuYW1lOiBwcm9wLCBkZXNjcmlwdGlvbjogc291cmNlW2tleV1bcHJvcF0gfSlcbiAgICB9XG5cbiAgICB0YXJnZXRba2V5XSA9IHByb3BJbmRleFxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuXG5mdW5jdGlvbiBkZXN0cnVjdHVyZSh0YXJnZXQsIHByb3BzKSB7XG4gIGNvbnN0IHNvdXJjZVByb3BzID0gKCFwcm9wcykgPyBbXSA6IEFycmF5LmZyb20ocHJvcHMpXG5cbiAgaWYgKCF0YXJnZXQpXG4gICAgcmV0dXJuIHNvdXJjZVByb3BzXG5cbiAgY29uc3QgdGFyZ2V0UHJvcHMgPSB7fVxuICBsZXQgcHJvcEluZGV4ID0gMFxuXG4gIC8vIExvb3AgdGhyb3VnaCBvdXIgdGFyZ2V0IGtleXMsIGFuZCBhc3NpZ24gdGhlIG9iamVjdCdzIGtleSB0byB0aGUgdmFsdWUgb2YgdGhlIHByb3BzIGlucHV0LlxuICBmb3IgKGNvbnN0IHRhcmdldFByb3Agb2YgdGFyZ2V0KSB7XG4gICAgdGFyZ2V0UHJvcHNbdGFyZ2V0UHJvcC5uYW1lXSA9IHNvdXJjZVByb3BzW3Byb3BJbmRleF1cbiAgICBwcm9wSW5kZXgrK1xuICB9XG5cbiAgLy8gSWYgd2UgZG9uJ3QgaGF2ZSBhIHZhbGlkIHRhcmdldDsgcmV0dXJuIHByb3BzIGFycmF5IGluc3RlYWQuIEV4YW1wbGU6IFsncHJvcDEnLCAncHJvcDInXVxuICBpZiAocHJvcEluZGV4ID09PSAwKVxuICAgIHJldHVybiBwcm9wc1xuXG4gIC8vIEV4YW1wbGU6IHsgc29tZUtleTogc29tZVZhbHVlLCBzb21lT3RoZXJLZXk6IHNvbWVPdGhlclZhbHVlIH1cbiAgcmV0dXJuIHRhcmdldFByb3BzXG59XG5cbmV4cG9ydCB7XG4gIGFzc2lnbk9iamVjdCxcbiAgc2V0RGVzY3JpcHRvcixcbiAgY3JlYXRlRGVzdHJ1Y3R1cmUsXG4gIGRlc3RydWN0dXJlXG59XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IHsgQmx1ZXByaW50TWV0aG9kcyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGFzc2lnbk9iamVjdCwgc2V0RGVzY3JpcHRvciB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gQmx1ZXByaW50U3R1Yih0YXJnZXQpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0ge31cbiAgYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICBibHVlcHJpbnQuc3R1YiA9IHRydWVcbiAgYmx1ZXByaW50LkZyYW1lID0ge1xuICAgIHBhcmVudHM6IFtdLFxuICAgIGRlc2NyaWJlOiBbXSxcbiAgfVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdGdW5jdGlvbicpXG4gICAgYmx1ZXByaW50LmluID0gdGFyZ2V0XG4gICAgYmx1ZXByaW50Lm9uID0gdGFyZ2V0XG4gIH0gZWxzZSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdQcmltaXRpdmUnKVxuICAgIGJsdWVwcmludC5pbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5pbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICAgIGJsdWVwcmludC5vbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5vbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTdHViXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCB7IGRlc3RydWN0dXJlIH0gZnJvbSAnLi9oZWxwZXJzJ1xuXG5mdW5jdGlvbiBwcm9jZXNzRmxvdygpIHtcbiAgLy8gQWxyZWFkeSBwcm9jZXNzaW5nIHRoaXMgQmx1ZXByaW50J3MgZmxvdy5cbiAgaWYgKHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cpXG4gICAgcmV0dXJuXG5cbiAgLy8gSWYgbm8gcGlwZXMgZm9yIGZsb3csIHRoZW4gbm90aGluZyB0byBkby5cbiAgaWYgKHRoaXMuRnJhbWUucGlwZXMubGVuZ3RoIDwgMSlcbiAgICByZXR1cm5cblxuICAvLyBDaGVjayB0aGF0IGFsbCBibHVlcHJpbnRzIGFyZSByZWFkeVxuICBpZiAoIWZsb3dzUmVhZHkuY2FsbCh0aGlzKSlcbiAgICByZXR1cm5cblxuICBsb2cuZGVidWcoJ1Byb2Nlc3NpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcbiAgbG9nLmRlYnVnKClcbiAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IHRydWVcblxuICAvLyBQdXQgdGhpcyBibHVlcHJpbnQgYXQgdGhlIGJlZ2lubmluZyBvZiB0aGUgZmxvdywgdGhhdCB3YXkgYW55IC5mcm9tIGV2ZW50cyB0cmlnZ2VyIHRoZSB3b3JrZXIgZmlyc3QuXG4gIHRoaXMuRnJhbWUucGlwZXMudW5zaGlmdCh7IGRpcmVjdGlvbjogJ3RvJywgdGFyZ2V0OiB0aGlzIH0pXG5cbiAgLy8gQnJlYWsgb3V0IGV2ZW50IHBpcGVzIGFuZCBmbG93IHBpcGVzIGludG8gc2VwYXJhdGUgYXJyYXlzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgICBpZiAoYmx1ZXByaW50ICYmIGJsdWVwcmludC5GcmFtZSlcbiAgICAgICAgYmx1ZXByaW50LkZyYW1lLnBhcmVudHMucHVzaCh7IHRhcmdldDogdGhpcyB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMCAod29ya2VyIGJsdWVwcmludClcbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIDApXG4gICAgICB0aGlzLkZyYW1lLmV2ZW50cy5wdXNoKHBpcGUpXG5cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludC5pbiAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBkb2VzIG5vdCBzdXBwb3J0IGlucHV0LicpXG5cbiAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIGkpXG4gICAgICB0aGlzLkZyYW1lLmZsb3cucHVzaChwaXBlKVxuICAgICAgaSsrXG4gICAgfVxuICB9XG5cbiAgc3RhcnRGbG93LmNhbGwodGhpcylcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29udGV4dCh3b3JrZXIsIGJsdWVwcmludCwgaW5kZXgpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBibHVlcHJpbnQubmFtZSxcbiAgICBzdGF0ZTogYmx1ZXByaW50LkZyYW1lLnN0YXRlIHx8IHt9LFxuICAgIG91dDogYmx1ZXByaW50Lm91dC5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICAgIGVycm9yOiBibHVlcHJpbnQuZXJyb3IuYmluZCh3b3JrZXIsIGluZGV4KSxcbiAgICAvKmZsb3c6IHtcbiAgICAgIHdvcmtlcjogd29ya2VyLm5hbWUsXG4gICAgICBzdGF0ZTogd29ya2VyLkZyYW1lLmZsb3dTdGF0ZSB8fCB7fSxcbiAgICB9Ki9cbiAgfVxufVxuXG5mdW5jdGlvbiBmbG93c1JlYWR5KCkge1xuICAvLyBpZiBibHVlcHJpbnQgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldCAoaS5lLiBjb25zdHJ1Y3RvciBub3QgdXNlZC4pXG4gIGlmICghdGhpcy5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0aGlzLCBwcm9jZXNzRmxvdylcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIExvb3AgdGhyb3VnaCBhbGwgYmx1ZXByaW50cyBpbiBmbG93IHRvIG1ha2Ugc3VyZSB0aGV5IGhhdmUgYmVlbiBsb2FkZWQgYW5kIGluaXRpYWxpemVkLlxuICBsZXQgZmxvd3NSZWFkeSA9IHRydWVcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCB0YXJnZXQgPSBwaXBlLnRhcmdldFxuXG4gICAgLy8gTm90IGEgYmx1ZXByaW50LCBlaXRoZXIgYSBmdW5jdGlvbiBvciBwcmltaXRpdmVcbiAgICBpZiAodGFyZ2V0LnN0dWIpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUubG9hZGVkKSB7XG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXQuRnJhbWUuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGluaXRCbHVlcHJpbnQuY2FsbCh0YXJnZXQsIHByb2Nlc3NGbG93LmJpbmQodGhpcykpXG4gICAgICBmbG93c1JlYWR5ID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZsb3dzUmVhZHlcbn1cblxuZnVuY3Rpb24gc3RhcnRGbG93KCkge1xuICBsb2cuZGVidWcoJ1N0YXJ0aW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG5cbiAgZm9yIChjb25zdCBldmVudCBvZiB0aGlzLkZyYW1lLmV2ZW50cykge1xuICAgIGNvbnN0IGJsdWVwcmludCA9IGV2ZW50LnRhcmdldFxuICAgIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLm9uLCBldmVudC5wYXJhbXMpXG4gICAgbG9nLmRlYnVnKGJsdWVwcmludC5uYW1lLCAncHJvcHMnLCBwcm9wcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgZG9uZSkge1xuICAgICAgICBkb25lKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6aW5nID0gZmFsc2VcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KSB9LCAxKVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmZ1bmN0aW9uIG5leHRQaXBlKGluZGV4LCBlcnIsIGRhdGEpIHtcbiAgbG9nLmRlYnVnKCduZXh0OicsIGluZGV4KVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgaWYgKGVycikge1xuICAgIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpXG4gICAgICByZXR1cm4gbG9nLmRlYnVnKCdObyBlcnJvciBoYW5kbGVyJylcblxuICAgIGlmIChuZXh0LnRhcmdldC5uYW1lID09PSAnRXJyb3InKSB7XG4gICAgICBuZXh0LmNvbnRleHQuaGFuZGxlRXJyb3IgPSB0cnVlXG4gICAgICBkYXRhID0gZXJyXG4gICAgfSBlbHNlIHtcbiAgICAgIGluZGV4KytcbiAgICAgIHJldHVybiBuZXh0UGlwZS5jYWxsKHRoaXMsIGluZGV4LCBlcnIpXG4gICAgfVxuICB9XG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuXG4gIGxldCByZXRWYWx1ZVxuICBsZXQgcmV0VHlwZVxuICB0cnkge1xuICAgIHJldFZhbHVlID0gYmx1ZXByaW50LmluLmNhbGwoY29udGV4dCwgZGF0YSwgcHJvcHMsIG5ldyBmYWN0b3J5KHBpcGVDYWxsYmFjaykuYmluZChjb250ZXh0KSlcbiAgICByZXRUeXBlID0gdHlwZW9mIHJldFZhbHVlXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldFZhbHVlID0gZXJyXG4gICAgcmV0VHlwZSA9ICdlcnJvcidcbiAgfVxuXG4gIC8vIEJsdWVwcmludC5pbiBkb2VzIG5vdCByZXR1cm4gYW55dGhpbmdcbiAgaWYgKCFyZXRWYWx1ZSB8fCByZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnZXJyb3InIHx8XG4gICAgICAgICAgICAgcmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBFcnJvciB8fFxuICAgICAgICAgICAgIHJldFR5cGUgPT09ICdvYmplY3QnICYmIHJldFZhbHVlLmNvbnN0cnVjdG9yLm5hbWUgPT09ICdFcnJvcicpIHtcbiAgICAvLyBIYW5kbGUgZXJyb3JzXG4gICAgY29udGV4dC5lcnJvcihyZXRWYWx1ZSlcbiAgfSBlbHNlIHtcbiAgICAvLyBIYW5kbGUgcmVndWxhciBwcmltaXRpdmVzIGFuZCBvYmplY3RzXG4gICAgY29udGV4dC5vdXQocmV0VmFsdWUpXG4gIH1cbn1cblxuZnVuY3Rpb24gZmFjdG9yeShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgfVxufVxuXG5mdW5jdGlvbiBwaXBlQ2FsbGJhY2soZXJyLCBkYXRhKSB7XG4gIGlmIChlcnIpXG4gICAgcmV0dXJuIHRoaXMuZXJyb3IoZXJyKVxuXG4gIHJldHVybiB0aGlzLm91dChkYXRhKVxufVxuXG5leHBvcnQgeyBwcm9jZXNzRmxvdywgbmV4dFBpcGUgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgQmx1ZXByaW50U3R1YiBmcm9tICcuL0JsdWVwcmludFN0dWInXG5pbXBvcnQgeyBwcm9jZXNzRmxvdywgbmV4dFBpcGUgfSBmcm9tICcuL2Zsb3cnXG5cbi8vIEJsdWVwcmludCBNZXRob2RzXG5jb25zdCBCbHVlcHJpbnRNZXRob2RzID0ge1xuICB0bzogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAndG8nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBmcm9tOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICdmcm9tJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgb3V0OiBmdW5jdGlvbihpbmRleCwgZGF0YSkge1xuICAgIGxvZy5kZWJ1ZygnV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLm91dDonLCBkYXRhLCBhcmd1bWVudHMpXG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgbnVsbCwgZGF0YV0pXG4gIH0sXG5cbiAgZXJyb3I6IGZ1bmN0aW9uKGluZGV4LCBlcnIpIHtcbiAgICBsb2cuZXJyb3IoJ1dvcmtlciAnICsgdGhpcy5uYW1lICsgJy5lcnJvcjonLCBlcnIsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBlcnJdKVxuICB9LFxuXG4gIGdldCB2YWx1ZSgpIHtcbiAgICAvLyBCYWlsIGlmIHdlJ3JlIG5vdCByZWFkeS4gKFVzZWQgdG8gZ2V0IG91dCBvZiBPYmplY3RNb2RlbCBhbmQgYXNzaWduT2JqZWN0IGxpbWJvKVxuICAgIGlmICghdGhpcy5GcmFtZSlcbiAgICAgIHJldHVybiAnJ1xuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2VGb3JWYWx1ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgYmx1ZXByaW50LkZyYW1lLmlzUHJvbWlzZWQgPSB0cnVlXG4gICAgICBibHVlcHJpbnQuRnJhbWUucHJvbWlzZSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QgfVxuICAgIH0pXG4gICAgcmV0dXJuIHByb21pc2VGb3JWYWx1ZVxuICB9LFxuXG4gIC8vY2F0Y2g6IGZ1bmN0aW9uKGNhbGxiYWNrKXsgLi4uIH1cbn1cblxuLy8gRmxvdyBNZXRob2QgaGVscGVyc1xuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICAvLyBRdWV1ZSBhcnJheSBpcyBwcmltYXJpbHkgZm9yIElERS5cbiAgbGV0IHF1ZXVlUG9zaXRpb24gPSBibHVlcHJpbnQuRnJhbWUucXVldWUubGVuZ3RoXG4gIGJsdWVwcmludC5GcmFtZS5xdWV1ZS5wdXNoKHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgLy8gVE9ETzogQ2xlYW51cCBxdWV1ZVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCAxKSlcbn1cblxuLy8gUGlwZSBjb250cm9sXG5mdW5jdGlvbiBhZGRQaXBlKGRpcmVjdGlvbiwgdGFyZ2V0LCBwYXJhbXMpIHtcbiAgaWYgKCF0aGlzKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG1ldGhvZCBjYWxsZWQgd2l0aG91dCBpbnN0YW5jZSwgZGlkIHlvdSBhc3NpZ24gdGhlIG1ldGhvZCB0byBhIHZhcmlhYmxlPycpXG5cbiAgaWYgKCF0aGlzLkZyYW1lIHx8ICF0aGlzLkZyYW1lLnBpcGVzKVxuICAgIHRocm93IG5ldyBFcnJvcignTm90IHdvcmtpbmcgd2l0aCBhIHZhbGlkIEJsdWVwcmludCBvYmplY3QnKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHRocm93IG5ldyBFcnJvcih0aGlzLkZyYW1lLm5hbWUgKyAnLicgKyBkaXJlY3Rpb24gKyAnKCkgd2FzIGNhbGxlZCB3aXRoIGltcHJvcGVyIHBhcmFtZXRlcnMnKVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiB0YXJnZXQudG8gIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH1cblxuICAvLyBFbnN1cmUgd2UncmUgd29ya2luZyBvbiBhIG5ldyBpbnN0YW5jZSBvZiB3b3JrZXIgYmx1ZXByaW50XG4gIGxldCBibHVlcHJpbnQgPSB0aGlzXG4gIGlmICghYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlKSB7XG4gICAgbG9nLmRlYnVnKCdDcmVhdGluZyBuZXcgaW5zdGFuY2UgZm9yJywgYmx1ZXByaW50Lm5hbWUpXG4gICAgYmx1ZXByaW50ID0gYmx1ZXByaW50KEFycmF5LmZyb20oYmx1ZXByaW50LkZyYW1lLnByb3BzKVswXSlcbiAgICBibHVlcHJpbnQuRnJhbWUuc3RhdGUgPSB0aGlzLkZyYW1lLnN0YXRlIC8vIFRPRE86IFNob3VsZCBjcmVhdGUgYSBuZXcgc3RhdGUgb2JqZWN0P1xuICAgIGJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSA9IHRydWVcbiAgfVxuXG4gIGxvZy5kZWJ1ZyhibHVlcHJpbnQubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKTogJyArIHRhcmdldC5uYW1lKVxuICBibHVlcHJpbnQuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuICByZXR1cm4gYmx1ZXByaW50XG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG5cbi8vIFRPRE86IE1vdmUgbmV4dFBpcGUsIGNhbGxOZXh0LCBhbmQgcGlwZUNhbGxiYWNrIHRvIGZsb3dcbiIsIid1c2Ugc3RyaWN0J1xuXG5jb25zdCBGbG93U2NoZW1hID0ge1xuICBkaXJlY3Rpb246ICcnLCAvLyB0byBvciBmcm9tXG4gIHRhcmdldDogbnVsbCxcbiAgcGFyYW1zOiBbXSxcbiAgY29udGV4dDoge1xuICAgIG5hbWU6ICcnLFxuICAgIHN0YXRlOiB7fSxcbiAgICBvdXQ6IGZ1bmN0aW9uKCl7fSxcbiAgICBlcnJvcjogZnVuY3Rpb24oKXt9LFxuICB9XG59XG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBuYW1lOiAnJyxcbiAgZGVzY3JpYmU6IFsnaW5pdCcsICdpbicsICdvdXQnXSwgLy8gVE9ETzogQ2hhbmdlIHRvIG9iamVjdCBhbmQgbWFrZSBzZXBhcmF0ZSBzY2hlbWEuIHsgaW5pdDogeyBuYW1lOiAnJywgZGVzY3JpcHRpb246ICcgfSB9XG4gIHByb3BzOiB7fSxcbiAgc3RhdGU6IHt9LFxuXG4gIGxvYWRlZDogZmFsc2UsXG4gIGluaXRpYWxpemVkOiBmYWxzZSxcbiAgcHJvY2Vzc2luZ0Zsb3c6IGZhbHNlLFxuICBpbnN0YW5jZTogZmFsc2UsXG5cbiAgZGVib3VuY2U6IHt9LFxuICBxdWV1ZTogW10sXG4gIHBhcmVudHM6IFtdLFxuXG4gIHBpcGVzOiBbXSwgLy9bRmxvd1NjaGVtYV0sXG4gIGV2ZW50czogW10sIC8vW0Zsb3dTY2hlbWFdLFxuICBmbG93OiBbXSwgLy9bRmxvd1NjaGVtYV0sXG5cbiAgaXNQcm9taXNlZDogZmFsc2UsXG4gIHByb21pc2U6IHt9LFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRCYXNlXG4iLCIndXNlIHN0cmljdCdcblxuLy8gQ29uY2VwdCBiYXNlZCBvbjogaHR0cDovL29iamVjdG1vZGVsLmpzLm9yZy9cbmZ1bmN0aW9uIE9iamVjdE1vZGVsKHNjaGVtYU9iaikge1xuICBpZiAodHlwZW9mIHNjaGVtYU9iaiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB7IHR5cGU6IHNjaGVtYU9iai5uYW1lLCBleHBlY3RzOiBzY2hlbWFPYmogfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFPYmogIT09ICdvYmplY3QnKVxuICAgIHNjaGVtYU9iaiA9IHt9XG5cbiAgLy8gQ2xvbmUgc2NoZW1hIG9iamVjdCBzbyB3ZSBkb24ndCBtdXRhdGUgaXQuXG4gIGNvbnN0IHNjaGVtYSA9IE9iamVjdC5jcmVhdGUoc2NoZW1hT2JqKVxuICBPYmplY3QuYXNzaWduKHNjaGVtYSwgc2NoZW1hT2JqKVxuXG4gIC8vIExvb3AgdGhyb3VnaCBTY2hlbWEgb2JqZWN0IGtleXNcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc2NoZW1hKSkge1xuICAgIC8vIENyZWF0ZSBhIHNjaGVtYSBvYmplY3Qgd2l0aCB0eXBlc1xuICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdmdW5jdGlvbicpXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSgpIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIEFycmF5LmlzQXJyYXkoc2NoZW1hW2tleV0pKSB7XG4gICAgICBjb25zdCBzY2hlbWFBcnIgPSBzY2hlbWFba2V5XVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ29wdGlvbmFsJywgdHlwZXM6IFtdIH1cbiAgICAgIGZvciAoY29uc3Qgc2NoZW1hVHlwZSBvZiBzY2hlbWFBcnIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzY2hlbWFUeXBlID09PSAnZnVuY3Rpb24nKVxuICAgICAgICAgIHNjaGVtYVtrZXldLnR5cGVzLnB1c2godHlwZW9mIHNjaGVtYVR5cGUoKSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiBzY2hlbWFba2V5XS50eXBlLCBleHBlY3RzOiBzY2hlbWFba2V5XS5leHBlY3RzIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0gfVxuICAgIH1cbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSBwcm9wc1xuICBmdW5jdGlvbiBpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpIHtcbiAgICAvLyBUT0RPOiBNYWtlIG1vcmUgZmxleGlibGUgYnkgZGVmaW5pbmcgbnVsbCBhbmQgdW5kZWZpbmVkIHR5cGVzLlxuICAgIC8vIE5vIHNjaGVtYSBkZWZpbmVkIGZvciBrZXlcbiAgICBpZiAoIXNjaGVtYVtrZXldKVxuICAgICAgcmV0dXJuIHRydWVcblxuICAgIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiB0eXBlb2YgdmFsdWUgPT09IHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmICghc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgaWYgKHZhbHVlICYmICFzY2hlbWFba2V5XS50eXBlcy5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKVxuICAgICAgICByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0uZXhwZWN0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gc2NoZW1hW2tleV0uZXhwZWN0cyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSAob25jZSBTY2hlbWEgY29uc3RydWN0b3IgaXMgY2FsbGVkKVxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGVTY2hlbWEob2JqVG9WYWxpZGF0ZSkge1xuICAgIGNvbnN0IHByb3h5T2JqID0ge31cbiAgICBjb25zdCBvYmogPSBvYmpUb1ZhbGlkYXRlXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmpUb1ZhbGlkYXRlKSkge1xuICAgICAgY29uc3QgcHJvcERlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9ialRvVmFsaWRhdGUsIGtleSlcblxuICAgICAgLy8gUHJvcGVydHkgYWxyZWFkeSBwcm90ZWN0ZWRcbiAgICAgIGlmICghcHJvcERlc2NyaXB0b3Iud3JpdGFibGUgfHwgIXByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyBTY2hlbWEgZG9lcyBub3QgZXhpc3QgZm9yIHByb3AsIHBhc3N0aHJvdWdoXG4gICAgICBpZiAoIXNjaGVtYVtrZXldKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICB9LFxuXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBBbnkgc2NoZW1hIGxlZnRvdmVyIHNob3VsZCBiZSBhZGRlZCBiYWNrIHRvIG9iamVjdCBmb3IgZnV0dXJlIHByb3RlY3Rpb25cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNjaGVtYSkpIHtcbiAgICAgICAgaWYgKG9ialtrZXldKVxuICAgICAgICAgIGNvbnRpbnVlXG5cbiAgICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICAgIH0sXG5cbiAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgICB9LFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBvYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgIH1cblxuICAgIHJldHVybiBvYmpcbiAgfVxufVxuXG5PYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayA9IE9iamVjdE1vZGVsKGZ1bmN0aW9uIFN0cmluZ05vdEJsYW5rKHN0cikge1xuICBpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpXG4gICAgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIHN0ci50cmltKCkubGVuZ3RoID4gMFxufSlcblxuZXhwb3J0IGRlZmF1bHQgT2JqZWN0TW9kZWxcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgT2JqZWN0TW9kZWwgZnJvbSAnLi9PYmplY3RNb2RlbCdcblxuLy8gUHJvdGVjdCBCbHVlcHJpbnQgdXNpbmcgYSBzY2hlbWFcbmNvbnN0IEJsdWVwcmludFNjaGVtYSA9IG5ldyBPYmplY3RNb2RlbCh7XG4gIG5hbWU6IE9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rLFxuXG4gIC8vIEJsdWVwcmludCBwcm92aWRlc1xuICBpbml0OiBbRnVuY3Rpb25dLFxuICBpbjogW0Z1bmN0aW9uXSxcbiAgb246IFtGdW5jdGlvbl0sXG4gIGRlc2NyaWJlOiBbT2JqZWN0XSxcblxuICAvLyBJbnRlcm5hbHNcbiAgb3V0OiBGdW5jdGlvbixcbiAgZXJyb3I6IEZ1bmN0aW9uLFxuICBjbG9zZTogW0Z1bmN0aW9uXSxcblxuICAvLyBVc2VyIGZhY2luZ1xuICB0bzogRnVuY3Rpb24sXG4gIGZyb206IEZ1bmN0aW9uLFxuXG4gIHZhbHVlOiBGdW5jdGlvbixcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludFNjaGVtYVxuIiwiLy8gVE9ETzogTW9kdWxlRmFjdG9yeSgpIGZvciBsb2FkZXIsIHdoaWNoIHBhc3NlcyB0aGUgbG9hZGVyICsgcHJvdG9jb2wgaW50byBpdC4uIFRoYXQgd2F5IGl0J3MgcmVjdXJzaXZlLi4uXG5cbmZ1bmN0aW9uIE1vZHVsZShfX2ZpbGVuYW1lLCBmaWxlQ29udGVudHMsIGNhbGxiYWNrKSB7XG4gIC8vIEZyb20gaWlmZSBjb2RlXG4gIGlmICghZmlsZUNvbnRlbnRzKVxuICAgIF9fZmlsZW5hbWUgPSBfX2ZpbGVuYW1lLnBhdGggfHwgJydcblxuICB2YXIgbW9kdWxlID0ge1xuICAgIGZpbGVuYW1lOiBfX2ZpbGVuYW1lLFxuICAgIGV4cG9ydHM6IHt9LFxuICAgIEJsdWVwcmludDogbnVsbCxcbiAgICByZXNvbHZlOiB7fSxcblxuICAgIHJlcXVpcmU6IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICAgIGxldCBmaWxlUGF0aFxuXG4gICAgICBpZiAodXJsLmluZGV4T2YoJy4vJykgIT09IC0xKSB7XG4gICAgICAgIGZpbGVQYXRoID0gdXJsXG4gICAgICB9IGVsc2UgaWYgKHVybC5pbmRleE9mKCdodHRwJykgIT09IC0xKSB7XG4gICAgICAgIGZpbGVQYXRoID0gdXJsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZVBhdGggPSAnLi4vbm9kZV9tb2R1bGVzLycgKyB1cmxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgZmlsZVBhdGgsIG51bGwsIGNhbGxiYWNrLCB0cnVlKVxuICAgIH0sXG4gIH1cblxuICBpZiAoIWNhbGxiYWNrKVxuICAgIHJldHVybiBtb2R1bGVcblxuICBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdID0gZnVuY3Rpb24oZXhwb3J0cykge1xuICAgIGNhbGxiYWNrKG51bGwsIGV4cG9ydHMpXG4gICAgZGVsZXRlIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV1cbiAgfVxuXG4gIGNvbnN0IHNjcmlwdCA9ICdtb2R1bGUucmVzb2x2ZVtcIicgKyBfX2ZpbGVuYW1lICsgJ1wiXShmdW5jdGlvbihpaWZlTW9kdWxlKXtcXG4nICtcbiAgJyAgdmFyIG1vZHVsZSA9IE1vZHVsZShpaWZlTW9kdWxlKVxcbicgK1xuICAnICB2YXIgX19maWxlbmFtZSA9IG1vZHVsZS5maWxlbmFtZVxcbicgK1xuICAnICB2YXIgX19kaXJuYW1lID0gX19maWxlbmFtZS5zbGljZSgwLCBfX2ZpbGVuYW1lLmxhc3RJbmRleE9mKFwiL1wiKSlcXG4nICtcbiAgJyAgdmFyIHJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxcbicgK1xuICAnICB2YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICcgIHZhciBwcm9jZXNzID0geyBicm93c2VyOiB0cnVlIH1cXG4nICtcbiAgJyAgdmFyIEJsdWVwcmludCA9IG51bGw7XFxuXFxuJyArXG5cbiAgJyhmdW5jdGlvbigpIHtcXG4nICsgLy8gQ3JlYXRlIElJRkUgZm9yIG1vZHVsZS9ibHVlcHJpbnRcbiAgJ1widXNlIHN0cmljdFwiO1xcbicgK1xuICAgIGZpbGVDb250ZW50cyArICdcXG4nICtcbiAgJ30pLmNhbGwobW9kdWxlLmV4cG9ydHMpO1xcbicgKyAvLyBDcmVhdGUgJ3RoaXMnIGJpbmRpbmcuXG4gICcgIGlmIChCbHVlcHJpbnQpIHsgcmV0dXJuIEJsdWVwcmludH1cXG4nICtcbiAgJyAgcmV0dXJuIG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICd9KG1vZHVsZSkpOydcblxuICB3aW5kb3cubW9kdWxlID0gbW9kdWxlXG4gIHdpbmRvdy5nbG9iYWwgPSB3aW5kb3dcbiAgd2luZG93Lk1vZHVsZSA9IE1vZHVsZVxuXG4gIHdpbmRvdy5yZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcblxuICByZXR1cm4gc2NyaXB0XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vZHVsZVxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuaW1wb3J0IE1vZHVsZSBmcm9tICcuLi8uLi9saWIvTW9kdWxlTG9hZGVyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4uLy4uL2xpYi9leHBvcnRzJ1xuXG4vLyBFbWJlZGRlZCBodHRwIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBodHRwTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9odHRwJyxcbiAgcHJvdG9jb2w6ICdsb2FkZXInLCAvLyBlbWJlZGRlZCBsb2FkZXJcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnSFRUUCBMb2FkZXInLFxuICAgIHByb3RvY29sOiBbJ2h0dHAnLCAnaHR0cHMnLCAnd2ViOi8vJ10sIC8vIFRPRE86IENyZWF0ZSBhIHdheSBmb3IgbG9hZGVyIHRvIHN1YnNjcmliZSB0byBtdWx0aXBsZSBwcm90b2NvbHNcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2ssIHNraXBOb3JtYWxpemF0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2ssIHNraXBOb3JtYWxpemF0aW9uKVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCdodHRwJykgPj0gMClcbiAgICAgICAgcmV0dXJuIGZpbGVOYW1lXG5cbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBjb25zdCBmaWxlUGF0aCA9ICdibHVlcHJpbnRzLycgKyBmaWxlXG4gICAgICByZXR1cm4gZmlsZVBhdGhcbiAgICB9LFxuXG4gICAgYnJvd3Nlcjoge1xuICAgICAgbG9hZDogZnVuY3Rpb24oZmlsZU5hbWUsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbikge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9ICghc2tpcE5vcm1hbGl6YXRpb24pID8gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSkgOiBmaWxlTmFtZVxuICAgICAgICBsb2cuZGVidWcoJ1todHRwIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZVBhdGgpXG5cbiAgICAgICAgdmFyIGlzQXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGlzQXN5bmMgPSBmYWxzZVxuICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCBmaWxlKSB7XG4gICAgICAgICAgICBpZiAoZXJyKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyKVxuXG4gICAgICAgICAgICByZXR1cm4gc3luY0ZpbGUgPSBmaWxlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgICAgLy8gVE9ETzogTmVlZHMgdmFsaWRhdGluZyB0aGF0IGV2ZW50IGhhbmRsZXJzIHdvcmsgYWNyb3NzIGJyb3dzZXJzLiBNb3JlIHNwZWNpZmljYWxseSwgdGhhdCB0aGV5IHJ1biBvbiBFUzUgZW52aXJvbm1lbnRzLlxuICAgICAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvWE1MSHR0cFJlcXVlc3QjQnJvd3Nlcl9jb21wYXRpYmlsaXR5XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IG5ldyB0aGlzLmJyb3dzZXIuc2NyaXB0RXZlbnRzKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuXG4gICAgICAgIHNjcmlwdFJlcXVlc3Qub3BlbignR0VUJywgZmlsZVBhdGgsIGlzQXN5bmMpXG4gICAgICAgIHNjcmlwdFJlcXVlc3Quc2VuZChudWxsKVxuXG4gICAgICAgIHJldHVybiBzeW5jRmlsZVxuICAgICAgfSxcblxuICAgICAgc2NyaXB0RXZlbnRzOiBmdW5jdGlvbihsb2FkZXIsIGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5maWxlTmFtZSA9IGZpbGVOYW1lXG4gICAgICAgIHRoaXMub25Mb2FkID0gbG9hZGVyLmJyb3dzZXIub25Mb2FkLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgICB0aGlzLm9uRXJyb3IgPSBsb2FkZXIuYnJvd3Nlci5vbkVycm9yLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgfSxcblxuICAgICAgb25Mb2FkOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IHRoaXNcblxuICAgICAgICAgIGlmIChzY3JpcHRSZXF1ZXN0LnN0YXR1cyA+IDQwMClcbiAgICAgICAgICAgIHJldHVybiBzY3JpcHRFdmVudHMub25FcnJvci5jYWxsKHNjcmlwdFJlcXVlc3QsIHNjcmlwdFJlcXVlc3Quc3RhdHVzVGV4dClcblxuICAgICAgICAgIGNvbnN0IHNjcmlwdENvbnRlbnQgPSBNb2R1bGUoc2NyaXB0UmVxdWVzdC5yZXNwb25zZVVSTCwgc2NyaXB0UmVxdWVzdC5yZXNwb25zZVRleHQsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcblxuICAgICAgICAgIHZhciBodG1sID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XG4gICAgICAgICAgdmFyIHNjcmlwdFRhZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpXG4gICAgICAgICAgc2NyaXB0VGFnLnRleHRDb250ZW50ID0gc2NyaXB0Q29udGVudFxuXG4gICAgICAgICAgaHRtbC5hcHBlbmRDaGlsZChzY3JpcHRUYWcpXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgb25FcnJvcjogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBzY3JpcHRFdmVudHMuZmlsZU5hbWVcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0VGFnID0gdGhpc1xuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG5cbiAgICAgICAgICAvLyBUcnkgdG8gZmFsbGJhY2sgdG8gaW5kZXguanNcbiAgICAgICAgICAvLyBGSVhNRTogaW5zdGVhZCBvZiBmYWxsaW5nIGJhY2ssIHRoaXMgc2hvdWxkIGJlIHRoZSBkZWZhdWx0IGlmIG5vIGAuanNgIGlzIGRldGVjdGVkLCBidXQgVVJMIHVnbGlmaWVycyBhbmQgc3VjaCB3aWxsIGhhdmUgaXNzdWVzLi4gaHJtbW1tLi5cbiAgICAgICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xICYmIGZpbGVOYW1lLmluZGV4T2YoJ2luZGV4LmpzJykgPT09IC0xKSB7XG4gICAgICAgICAgICBsb2cud2FybignW2h0dHBdIEF0dGVtcHRpbmcgdG8gZmFsbGJhY2sgdG86ICcsIGZpbGVOYW1lICsgJy9pbmRleC5qcycpXG4gICAgICAgICAgICByZXR1cm4gbG9hZGVyLmluLmNhbGwobG9hZGVyLCBmaWxlTmFtZSArICcvaW5kZXguanMnLCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKCdDb3VsZCBub3QgbG9hZCBCbHVlcHJpbnQnKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBjbGVhbnVwOiBmdW5jdGlvbihzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cykge1xuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuICAgICAgICAvL2RvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdoZWFkJylbMF0ucmVtb3ZlQ2hpbGQoc2NyaXB0VGFnKSAvLyBUT0RPOiBDbGVhbnVwXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICBub2RlOiB7XG4gICAgICAvLyBTdHViIGZvciBub2RlLmpzIEhUVFAgbG9hZGluZyBzdXBwb3J0LlxuICAgIH0sXG5cbiAgfSxcbn1cblxuZXhwb3J0ZXIoJ2h0dHAnLCBodHRwTG9hZGVyKSAvLyBUT0RPOiBDbGVhbnVwLCBleHBvc2UgbW9kdWxlcyBpbnN0ZWFkXG5cbmV4cG9ydCBkZWZhdWx0IGh0dHBMb2FkZXJcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcblxuLy8gRW1iZWRkZWQgZmlsZSBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgZmlsZUxvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvZmlsZScsXG4gIHByb3RvY29sOiAnZW1iZWQnLFxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdGaWxlIExvYWRlcicsXG4gICAgcHJvdG9jb2w6ICdmaWxlJyxcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICh0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlOi8vIGxvYWRpbmcgd2l0aGluIGJyb3dzZXIgbm90IHN1cHBvcnRlZCB5ZXQuIFRyeSByZWxhdGl2ZSBVUkwgaW5zdGVhZC4nKVxuXG4gICAgICBsb2cuZGVidWcoJ1tmaWxlIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZU5hbWUpXG5cbiAgICAgIC8vIFRPRE86IFN3aXRjaCB0byBhc3luYyBmaWxlIGxvYWRpbmcsIGltcHJvdmUgcmVxdWlyZSgpLCBwYXNzIGluIElJRkUgdG8gc2FuZGJveCwgdXNlIElJRkUgcmVzb2x2ZXIgZm9yIGNhbGxiYWNrXG4gICAgICAvLyBUT0RPOiBBZGQgZXJyb3IgcmVwb3J0aW5nLlxuXG4gICAgICBjb25zdCB2bSA9IHJlcXVpcmUoJ3ZtJylcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG5cbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnJlc29sdmVGaWxlKGZpbGVQYXRoKVxuICAgICAgaWYgKCFmaWxlKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ0JsdWVwcmludCBub3QgZm91bmQnKVxuXG4gICAgICBjb25zdCBmaWxlQ29udGVudHMgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZSkudG9TdHJpbmcoKVxuXG4gICAgICAvLyBUT0RPOiBDcmVhdGUgYSBtb3JlIGNvbXBsZXRlIHNhbmRib3ggb2JqZWN0XG4gICAgICBjb25zdCBzYW5kYm94ID0ge1xuICAgICAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgICAgIHJlcXVpcmU6IGZ1bmN0aW9uKG1vZHVsZUZpbGUpIHsgcmV0dXJuIHJlcXVpcmUoZmlsZVBhdGggKyAnL25vZGVfbW9kdWxlcy8nICsgbW9kdWxlRmlsZSkgfSxcbiAgICAgICAgY29uc29sZTogeyBsb2c6IGxvZywgZXJyb3I6IGxvZy5lcnJvciwgd2FybjogbG9nLndhcm4sIGluZm86IGxvZy5pbmZvIH0sXG4gICAgICAgIGdsb2JhbDogZ2xvYmFsLFxuICAgICAgICBtb2R1bGU6IG1vZHVsZSxcbiAgICAgICAgX19kaXJuYW1lOiBmaWxlUGF0aCxcbiAgICAgIH1cblxuICAgICAgdm0uY3JlYXRlQ29udGV4dChzYW5kYm94KVxuICAgICAgdm0ucnVuSW5Db250ZXh0KGZpbGVDb250ZW50cywgc2FuZGJveClcbiAgICAgIGNhbGxiYWNrKG51bGwsIHNhbmRib3guQmx1ZXByaW50KVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcbiAgICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcblxuICAgIHJlc29sdmVGaWxlOiBmdW5jdGlvbihmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG5cbiAgICAgIC8vIElmIGZpbGUgb3IgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIGJsdWVwcmludCBpcyBhIGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMoZmlsZVBhdGgpLmlzRGlyZWN0b3J5KCkpXG4gICAgICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShmaWxlUGF0aCwgJ2luZGV4LmpzJylcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHJldHVybiBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICB9XG5cbiAgICAgIC8vIFRyeSBhZGRpbmcgYW4gZXh0ZW5zaW9uIHRvIHNlZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSlcbiAgICAgICAgcmV0dXJuIGZpbGVcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgfSxcbn1cblxuXG5leHBvcnQgZGVmYXVsdCBmaWxlTG9hZGVyXG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBwcmVmZXItdGVtcGxhdGUgKi9cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgaHR0cExvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cCdcbmltcG9ydCBmaWxlTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlJ1xuXG4vLyBNdWx0aS1lbnZpcm9ubWVudCBhc3luYyBtb2R1bGUgbG9hZGVyXG5jb25zdCBtb2R1bGVzID0ge1xuICAnbG9hZGVycy9odHRwJzogaHR0cExvYWRlcixcbiAgJ2xvYWRlcnMvZmlsZSc6IGZpbGVMb2FkZXIsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5hbWUobmFtZSkge1xuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggZWFjaCBmaWxlIHBhdGggYW5kIG5vcm1hbGl6ZSBpdCB0b286XG4gIHJldHVybiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLy8uY2FwaXRhbGl6ZSgpXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVGaWxlSW5mbyhmaWxlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGaWxlTmFtZSA9IG5vcm1hbGl6ZU5hbWUoZmlsZSlcbiAgY29uc3QgcHJvdG9jb2wgPSBwYXJzZVByb3RvY29sKGZpbGUpXG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlOiBmaWxlLFxuICAgIHBhdGg6IGZpbGUsXG4gICAgbmFtZTogbm9ybWFsaXplZEZpbGVOYW1lLFxuICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVByb3RvY29sKG5hbWUpIHtcbiAgLy8gRklYTUU6IG5hbWUgc2hvdWxkIG9mIGJlZW4gbm9ybWFsaXplZCBieSBub3cuIEVpdGhlciByZW1vdmUgdGhpcyBjb2RlIG9yIG1vdmUgaXQgc29tZXdoZXJlIGVsc2UuLlxuICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsb2FkZXIgYmx1ZXByaW50IG5hbWUnKVxuXG4gIHZhciBwcm90b1Jlc3VsdHMgPSBuYW1lLm1hdGNoKC86XFwvXFwvL2dpKSAmJiBuYW1lLnNwbGl0KC86XFwvXFwvL2dpKVxuXG4gIC8vIE5vIHByb3RvY29sIGZvdW5kLCBpZiBicm93c2VyIGVudmlyb25tZW50IHRoZW4gaXMgcmVsYXRpdmUgVVJMIGVsc2UgaXMgYSBmaWxlIHBhdGguIChTYW5lIGRlZmF1bHRzIGJ1dCBjYW4gYmUgb3ZlcnJpZGRlbilcbiAgaWYgKCFwcm90b1Jlc3VsdHMpXG4gICAgcmV0dXJuICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyAnaHR0cCcgOiAnZmlsZSdcblxuICByZXR1cm4gcHJvdG9SZXN1bHRzWzBdXG59XG5cbmZ1bmN0aW9uIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpIHtcbiAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBtb2R1bGUuY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2sobW9kdWxlLm1vZHVsZSlcbiAgfVxuXG4gIG1vZHVsZS5jYWxsYmFja3MgPSBbXVxufVxuXG5jb25zdCBpbXBvcnRzID0gZnVuY3Rpb24obmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlSW5mbyA9IHJlc29sdmVGaWxlSW5mbyhuYW1lKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gZmlsZUluZm8ubmFtZVxuICAgIGNvbnN0IHByb3RvY29sID0gZmlsZUluZm8ucHJvdG9jb2xcblxuICAgIGxvZy5kZWJ1ZygnbG9hZGluZyBtb2R1bGU6JywgZmlsZU5hbWUpXG5cbiAgICAvLyBNb2R1bGUgaGFzIGxvYWRlZCBvciBzdGFydGVkIHRvIGxvYWRcbiAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0pXG4gICAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0ubG9hZGVkKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2sobW9kdWxlc1tmaWxlTmFtZV0ubW9kdWxlKSAvLyBSZXR1cm4gbW9kdWxlIGZyb20gQ2FjaGVcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG1vZHVsZXNbZmlsZU5hbWVdLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAvLyBOb3QgbG9hZGVkIHlldCwgcmVnaXN0ZXIgY2FsbGJhY2tcblxuICAgIG1vZHVsZXNbZmlsZU5hbWVdID0ge1xuICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxuICAgICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICAgICAgbG9hZGVkOiBmYWxzZSxcbiAgICAgIGNhbGxiYWNrczogW2NhbGxiYWNrXSxcbiAgICB9XG5cbiAgICAvLyBCb290c3RyYXBwaW5nIGxvYWRlciBibHVlcHJpbnRzIDspXG4gICAgLy9GcmFtZSgnTG9hZGVycy8nICsgcHJvdG9jb2wpLmZyb20oZmlsZU5hbWUpLnRvKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpIHt9KVxuXG4gICAgY29uc3QgbG9hZGVyID0gJ2xvYWRlcnMvJyArIHByb3RvY29sXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbml0KCkgLy8gVE9ETzogb3B0aW9uYWwgaW5pdCAoaW5zaWRlIEZyYW1lIGNvcmUpXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbihmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKXtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIGxvZy5lcnJvcignRXJyb3I6ICcsIGVyciwgZmlsZU5hbWUpXG4gICAgICBlbHNlIHtcbiAgICAgICAgbG9nLmRlYnVnKCdMb2FkZWQgQmx1ZXByaW50IG1vZHVsZTogJywgZmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKCFleHBvcnRGaWxlIHx8IHR5cGVvZiBleHBvcnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0RmlsZS5uYW1lICE9PSAnc3RyaW5nJylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBtaXNzaW5nIGEgbmFtZScpXG5cbiAgICAgICAgY29uc3QgbW9kdWxlID0gbW9kdWxlc1tmaWxlTmFtZV1cbiAgICAgICAgaWYgKCFtb2R1bGUpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVaCBvaCwgd2Ugc2hvdWxkbnQgYmUgaGVyZScpXG5cbiAgICAgICAgLy8gTW9kdWxlIGFscmVhZHkgbG9hZGVkLiBOb3Qgc3VwcG9zZSB0byBiZSBoZXJlLiBPbmx5IGZyb20gZm9yY2UtbG9hZGluZyB3b3VsZCBnZXQgeW91IGhlcmUuXG4gICAgICAgIGlmIChtb2R1bGUubG9hZGVkKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFwiJyArIGV4cG9ydEZpbGUubmFtZSArICdcIiBhbHJlYWR5IGxvYWRlZC4nKVxuXG4gICAgICAgIG1vZHVsZS5tb2R1bGUgPSBleHBvcnRGaWxlXG4gICAgICAgIG1vZHVsZS5sb2FkZWQgPSB0cnVlXG5cbiAgICAgICAgcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gVE9ETzogbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5idW5kbGUgc3VwcG9ydCBmb3IgQ0xJIHRvb2xpbmcuXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgbG9hZCBibHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBpbXBvcnRzXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuL2V4cG9ydHMnXG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycydcbmltcG9ydCBCbHVlcHJpbnRNZXRob2RzIGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCBCbHVlcHJpbnRCYXNlIGZyb20gJy4vQmx1ZXByaW50QmFzZSdcbmltcG9ydCBCbHVlcHJpbnRTY2hlbWEgZnJvbSAnLi9zY2hlbWEnXG5pbXBvcnQgaW1wb3J0cyBmcm9tICcuL2xvYWRlcidcblxuLy8gRnJhbWUgYW5kIEJsdWVwcmludCBjb25zdHJ1Y3RvcnNcbmNvbnN0IHNpbmdsZXRvbnMgPSB7fVxuZnVuY3Rpb24gRnJhbWUobmFtZSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRnJhbWUpKVxuICAgIHJldHVybiBuZXcgRnJhbWUobmFtZSwgb3B0cylcblxuICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG5hbWUgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nKVxuXG4gIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnQobmFtZSlcbiAgaW1wb3J0cyhuYW1lLCBvcHRzLCBmdW5jdGlvbihibHVlcHJpbnRGaWxlKSB7XG4gICAgdHJ5IHtcblxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgbG9hZGVkOicsIGJsdWVwcmludEZpbGUubmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBibHVlcHJpbnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgLy8gVXBkYXRlIGZhdXggYmx1ZXByaW50IHN0dWIgd2l0aCByZWFsIG1vZHVsZVxuICAgICAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlKVxuXG4gICAgICAvLyBVcGRhdGUgYmx1ZXByaW50IG5hbWVcbiAgICAgIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsIGJsdWVwcmludEZpbGUubmFtZSwgZmFsc2UpXG4gICAgICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IGJsdWVwcmludEZpbGUubmFtZVxuXG4gICAgICAvLyBBcHBseSBhIHNjaGVtYSB0byBibHVlcHJpbnRcbiAgICAgIGJsdWVwcmludCA9IEJsdWVwcmludFNjaGVtYShibHVlcHJpbnQpXG5cbiAgICAgIC8vIFZhbGlkYXRlIEJsdWVwcmludCBpbnB1dCB3aXRoIG9wdGlvbmFsIHByb3BlcnR5IGRlc3RydWN0dXJpbmcgKHVzaW5nIGRlc2NyaWJlIG9iamVjdClcbiAgICAgIGJsdWVwcmludC5GcmFtZS5kZXNjcmliZSA9IGhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUoYmx1ZXByaW50LmRlc2NyaWJlLCBCbHVlcHJpbnRCYXNlLmRlc2NyaWJlKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpXG4gIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdCbHVlcHJpbnQnLCB0cnVlKVxuXG4gIC8vIEJsdWVwcmludCBtZXRob2RzXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICAvLyBDcmVhdGUgaGlkZGVuIGJsdWVwcmludC5GcmFtZSBwcm9wZXJ0eSB0byBrZWVwIHN0YXRlXG4gIGNvbnN0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gICAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEZyYW1lKG5hbWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0gYXJndW1lbnRzXG5cbiAgICBsb2cuZGVidWcoJ2NvbnN0cnVjdG9yIGNhbGxlZCBmb3InLCBuYW1lKVxuXG4gICAgcmV0dXJuIGJsdWVwcmludFxuICB9XG59XG5cbi8vIEdpdmUgRnJhbWUgYW4gZWFzeSBkZXNjcmlwdG9yXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUsICdDb25zdHJ1Y3RvcicpXG5oZWxwZXJzLnNldERlc2NyaXB0b3IoRnJhbWUuY29uc3RydWN0b3IsICdGcmFtZScpXG5cbi8vIEV4cG9ydCBGcmFtZSBnbG9iYWxseVxuZXhwb3J0ZXIoJ0ZyYW1lJywgRnJhbWUpXG5leHBvcnQgZGVmYXVsdCBGcmFtZVxuIl0sIm5hbWVzIjpbInF1ZXVlIiwiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBp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
