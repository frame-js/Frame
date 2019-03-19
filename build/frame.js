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
      // TODO: Check if we will have a race condition with flow.js: blueprint.Frame.props = {}
      blueprint.Frame.props = this.Frame.props;
      blueprint.Frame.state = this.Frame.state;
      blueprint.Frame.instance = true;
    }
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    // Used when target blueprint is part of another flow
    if (target && target.Frame)
      target.Frame.parents.push({ target: blueprint }); // TODO: Check if worker blueprint is already added.

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
    describe: ['init', 'in', 'out'],
    props: {},
    state: {},

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
        let filePath;

        if (url.indexOf('./') !== -1) {
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
          require: require,
          console: { log: log, error: log.error, warn: log.warn }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmRlYnVnID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nLmRlYnVnKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZy5kZWJ1ZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgMClcbiAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcblxuICAgIH0gZWxzZSBpZiAocGlwZS5kaXJlY3Rpb24gPT09ICd0bycpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50LmluICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgaW5wdXQuJylcblxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDb250ZXh0KHdvcmtlciwgYmx1ZXByaW50LCBpbmRleCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGJsdWVwcmludC5uYW1lLFxuICAgIHN0YXRlOiBibHVlcHJpbnQuRnJhbWUuc3RhdGUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZy5kZWJ1ZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgZG9uZSkge1xuICAgICAgICBkb25lKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludCkgfSwgMSlcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgeyBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCB7IGRlc3RydWN0dXJlLCBhc3NpZ25PYmplY3QsIHNldERlc2NyaXB0b3IgfSBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgeyBwcm9jZXNzRmxvdyB9IGZyb20gJy4vZmxvdydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICd0bycsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIGZyb206IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBvdXQ6IGZ1bmN0aW9uKGluZGV4LCBkYXRhKSB7XG4gICAgbG9nLmRlYnVnKCdXb3JrZXIgJyArIHRoaXMubmFtZSArICcub3V0OicsIGRhdGEsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGxvZy5lcnJvcignV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLmVycm9yOicsIGVyciwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgZ2V0IHZhbHVlKCkge1xuICAgIC8vIEJhaWwgaWYgd2UncmUgbm90IHJlYWR5LiAoVXNlZCB0byBnZXQgb3V0IG9mIE9iamVjdE1vZGVsIGFuZCBhc3NpZ25PYmplY3QgbGltYm8pXG4gICAgaWYgKCF0aGlzLkZyYW1lKVxuICAgICAgcmV0dXJuICcnXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG4gICAgY29uc3QgcHJvbWlzZUZvclZhbHVlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9taXNlID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCB9XG4gICAgfSlcbiAgICByZXR1cm4gcHJvbWlzZUZvclZhbHVlXG4gIH0sXG59XG5cbi8vIEZsb3cgTWV0aG9kIGhlbHBlcnNcbmZ1bmN0aW9uIEJsdWVwcmludFN0dWIodGFyZ2V0KSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IHt9XG4gIGFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgYmx1ZXByaW50LnN0dWIgPSB0cnVlXG4gIGJsdWVwcmludC5GcmFtZSA9IHtcbiAgICBwYXJlbnRzOiBbXSxcbiAgICBkZXNjcmliZTogW10sXG4gIH1cblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnRnVuY3Rpb24nKVxuICAgIGJsdWVwcmludC5pbiA9IHRhcmdldFxuICAgIGJsdWVwcmludC5vbiA9IHRhcmdldFxuICB9IGVsc2Uge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnUHJpbWl0aXZlJylcbiAgICBibHVlcHJpbnQuaW4gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcuaW46JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgICBibHVlcHJpbnQub24gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcub246JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5xdWV1ZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucXVldWUgPSBbXVxuXG4gIC8vIFF1ZXVlIGFycmF5IGlzIHByaW1hcmlseSBmb3IgSURFLlxuICBsZXQgcXVldWVQb3NpdGlvbiA9IGJsdWVwcmludC5GcmFtZS5xdWV1ZS5sZW5ndGhcbiAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlLnB1c2goc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBDbGVhbnVwIHF1ZXVlXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIDEpKVxufVxuXG5mdW5jdGlvbiBmYWN0b3J5KGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICB9XG59XG5cbi8vIFBpcGUgY29udHJvbFxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgaW5zdGFuY2UsIGRpZCB5b3UgYXNzaWduIHRoZSBtZXRob2QgdG8gYSB2YXJpYWJsZT8nKVxuXG4gIGlmICghdGhpcy5GcmFtZSB8fCAhdGhpcy5GcmFtZS5waXBlcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCB3b3JraW5nIHdpdGggYSB2YWxpZCBCbHVlcHJpbnQgb2JqZWN0JylcblxuICBpZiAoIXRhcmdldClcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdGFyZ2V0LnRvICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9XG5cbiAgLy8gRW5zdXJlIHdlJ3JlIHdvcmtpbmcgb24gYSBuZXcgaW5zdGFuY2Ugb2Ygd29ya2VyIGJsdWVwcmludFxuICBsZXQgYmx1ZXByaW50ID0gdGhpc1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSkge1xuICAgIGJsdWVwcmludCA9IGJsdWVwcmludCgpXG4gICAgLy8gVE9ETzogQ2hlY2sgaWYgd2Ugd2lsbCBoYXZlIGEgcmFjZSBjb25kaXRpb24gd2l0aCBmbG93LmpzOiBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSB7fVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHRoaXMuRnJhbWUucHJvcHNcbiAgICBibHVlcHJpbnQuRnJhbWUuc3RhdGUgPSB0aGlzLkZyYW1lLnN0YXRlXG4gICAgYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlID0gdHJ1ZVxuICB9XG5cbiAgbG9nLmRlYnVnKGJsdWVwcmludC5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpOiAnICsgdGFyZ2V0Lm5hbWUpXG4gIGJsdWVwcmludC5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuXG4gIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gIGlmICh0YXJnZXQgJiYgdGFyZ2V0LkZyYW1lKVxuICAgIHRhcmdldC5GcmFtZS5wYXJlbnRzLnB1c2goeyB0YXJnZXQ6IGJsdWVwcmludCB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGxvZy5kZWJ1ZygnbmV4dDonLCBpbmRleClcbiAgaWYgKGVycikge1xuICAgIGxvZy5lcnJvcignVE9ETzogaGFuZGxlIGVycm9yOicsIGVycilcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGNvbnRleHQsIGRhdGEsIHByb3BzLCBuZXcgZmFjdG9yeShwaXBlQ2FsbGJhY2spLmJpbmQoY29udGV4dCkpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnRleHQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGNvbnRleHQub3V0KHJldFZhbHVlKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBpcGVDYWxsYmFjayhlcnIsIGRhdGEpIHtcbiAgaWYgKGVycilcbiAgICByZXR1cm4gdGhpcy5lcnJvcihlcnIpXG5cbiAgcmV0dXJuIHRoaXMub3V0KGRhdGEpXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuLy8gSW50ZXJuYWwgRnJhbWUgcHJvcHNcbmNvbnN0IEJsdWVwcmludEJhc2UgPSB7XG4gIG5hbWU6ICcnLFxuICBkZXNjcmliZTogWydpbml0JywgJ2luJywgJ291dCddLFxuICBwcm9wczoge30sXG4gIHN0YXRlOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgZGVib3VuY2U6IHt9LFxuICBwYXJlbnRzOiBbXSxcblxuICBpbnN0YW5jZTogZmFsc2UsXG4gIHBpcGVzOiBbXSxcbiAgZXZlbnRzOiBbXSxcbiAgZmxvdzogW10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LmNyZWF0ZShzY2hlbWFPYmopXG4gIE9iamVjdC5hc3NpZ24oc2NoZW1hLCBzY2hlbWFPYmopXG5cbiAgLy8gTG9vcCB0aHJvdWdoIFNjaGVtYSBvYmplY3Qga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGNvbnN0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChjb25zdCBzY2hlbWFUeXBlIG9mIHNjaGVtYUFycikge1xuICAgICAgICBpZiAodHlwZW9mIHNjaGVtYVR5cGUgPT09ICdmdW5jdGlvbicpXG4gICAgICAgICAgc2NoZW1hW2tleV0udHlwZXMucHVzaCh0eXBlb2Ygc2NoZW1hVHlwZSgpKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHNjaGVtYVtrZXldLnR5cGUsIGV4cGVjdHM6IHNjaGVtYVtrZXldLmV4cGVjdHMgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSB9XG4gICAgfVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIHByb3BzXG4gIGZ1bmN0aW9uIGlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkge1xuICAgIC8vIFRPRE86IE1ha2UgbW9yZSBmbGV4aWJsZSBieSBkZWZpbmluZyBudWxsIGFuZCB1bmRlZmluZWQgdHlwZXMuXG4gICAgLy8gTm8gc2NoZW1hIGRlZmluZWQgZm9yIGtleVxuICAgIGlmICghc2NoZW1hW2tleV0pXG4gICAgICByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHR5cGVvZiB2YWx1ZSA9PT0gc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKCFzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICBpZiAodmFsdWUgJiYgIXNjaGVtYVtrZXldLnR5cGVzLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gICAgICAgIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XS5leHBlY3RzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWFba2V5XS5leHBlY3RzKHZhbHVlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIChvbmNlIFNjaGVtYSBjb25zdHJ1Y3RvciBpcyBjYWxsZWQpXG4gIHJldHVybiBmdW5jdGlvbiB2YWxpZGF0ZVNjaGVtYShvYmpUb1ZhbGlkYXRlKSB7XG4gICAgY29uc3QgcHJveHlPYmogPSB7fVxuICAgIGNvbnN0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9ialRvVmFsaWRhdGUpKSB7XG4gICAgICBjb25zdCBwcm9wRGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqVG9WYWxpZGF0ZSwga2V5KVxuXG4gICAgICAvLyBQcm9wZXJ0eSBhbHJlYWR5IHByb3RlY3RlZFxuICAgICAgaWYgKCFwcm9wRGVzY3JpcHRvci53cml0YWJsZSB8fCAhcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIFNjaGVtYSBkb2VzIG5vdCBleGlzdCBmb3IgcHJvcCwgcGFzc3Rocm91Z2hcbiAgICAgIGlmICghc2NoZW1hW2tleV0pIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgIH0sXG5cbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFueSBzY2hlbWEgbGVmdG92ZXIgc2hvdWxkIGJlIGFkZGVkIGJhY2sgdG8gb2JqZWN0IGZvciBmdXR1cmUgcHJvdGVjdGlvblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBvbjogW0Z1bmN0aW9uXSxcbiAgZGVzY3JpYmU6IFtPYmplY3RdLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIFVzZXIgZmFjaW5nXG4gIHRvOiBGdW5jdGlvbixcbiAgZnJvbTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICBsZXQgZmlsZVBhdGhcblxuICAgICAgaWYgKHVybC5pbmRleE9mKCcuLycpICE9PSAtMSkge1xuICAgICAgICBmaWxlUGF0aCA9IHVybFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZVBhdGggPSAnLi4vbm9kZV9tb2R1bGVzLycgKyB1cmxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgZmlsZVBhdGgsIG51bGwsIGNhbGxiYWNrLCB0cnVlKVxuICAgIH0sXG4gIH1cblxuICBpZiAoIWNhbGxiYWNrKVxuICAgIHJldHVybiBtb2R1bGVcblxuICBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdID0gZnVuY3Rpb24oZXhwb3J0cykge1xuICAgIGNhbGxiYWNrKG51bGwsIGV4cG9ydHMpXG4gICAgZGVsZXRlIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV1cbiAgfVxuXG4gIGNvbnN0IHNjcmlwdCA9ICdtb2R1bGUucmVzb2x2ZVtcIicgKyBfX2ZpbGVuYW1lICsgJ1wiXShmdW5jdGlvbihpaWZlTW9kdWxlKXtcXG4nICtcbiAgJyAgdmFyIG1vZHVsZSA9IE1vZHVsZShpaWZlTW9kdWxlKVxcbicgK1xuICAnICB2YXIgX19maWxlbmFtZSA9IG1vZHVsZS5maWxlbmFtZVxcbicgK1xuICAnICB2YXIgX19kaXJuYW1lID0gX19maWxlbmFtZS5zbGljZSgwLCBfX2ZpbGVuYW1lLmxhc3RJbmRleE9mKFwiL1wiKSlcXG4nICtcbiAgJyAgdmFyIHJlcXVpcmUgPSBtb2R1bGUucmVxdWlyZVxcbicgK1xuICAnICB2YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICcgIHZhciBwcm9jZXNzID0geyBicm93c2VyOiB0cnVlIH1cXG4nICtcbiAgJyAgdmFyIEJsdWVwcmludCA9IG51bGw7XFxuXFxuJyArXG5cbiAgJyhmdW5jdGlvbigpIHtcXG4nICsgLy8gQ3JlYXRlIElJRkUgZm9yIG1vZHVsZS9ibHVlcHJpbnRcbiAgJ1widXNlIHN0cmljdFwiO1xcbicgK1xuICAgIGZpbGVDb250ZW50cyArICdcXG4nICtcbiAgJ30pLmNhbGwobW9kdWxlLmV4cG9ydHMpO1xcbicgKyAvLyBDcmVhdGUgJ3RoaXMnIGJpbmRpbmcuXG4gICcgIGlmIChCbHVlcHJpbnQpIHsgcmV0dXJuIEJsdWVwcmludH1cXG4nICtcbiAgJyAgcmV0dXJuIG1vZHVsZS5leHBvcnRzXFxuJyArXG4gICd9KG1vZHVsZSkpOydcblxuICB3aW5kb3cubW9kdWxlID0gbW9kdWxlXG4gIHdpbmRvdy5nbG9iYWwgPSB3aW5kb3dcbiAgd2luZG93Lk1vZHVsZSA9IE1vZHVsZVxuXG4gIHdpbmRvdy5yZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcblxuICByZXR1cm4gc2NyaXB0XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vZHVsZVxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuaW1wb3J0IE1vZHVsZSBmcm9tICcuLi8uLi9saWIvTW9kdWxlTG9hZGVyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4uLy4uL2xpYi9leHBvcnRzJ1xuXG4vLyBFbWJlZGRlZCBodHRwIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBodHRwTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9odHRwJyxcbiAgcHJvdG9jb2w6ICdsb2FkZXInLCAvLyBlbWJlZGRlZCBsb2FkZXJcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnSFRUUCBMb2FkZXInLFxuICAgIHByb3RvY29sOiBbJ2h0dHAnLCAnaHR0cHMnLCAnd2ViOi8vJ10sIC8vIFRPRE86IENyZWF0ZSBhIHdheSBmb3IgbG9hZGVyIHRvIHN1YnNjcmliZSB0byBtdWx0aXBsZSBwcm90b2NvbHNcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2ssIHNraXBOb3JtYWxpemF0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2ssIHNraXBOb3JtYWxpemF0aW9uKVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCdodHRwJykgPj0gMClcbiAgICAgICAgcmV0dXJuIGZpbGVOYW1lXG5cbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlTmFtZSArICgoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBjb25zdCBmaWxlUGF0aCA9ICdibHVlcHJpbnRzLycgKyBmaWxlXG4gICAgICByZXR1cm4gZmlsZVBhdGhcbiAgICB9LFxuXG4gICAgYnJvd3Nlcjoge1xuICAgICAgbG9hZDogZnVuY3Rpb24oZmlsZU5hbWUsIGNhbGxiYWNrLCBza2lwTm9ybWFsaXphdGlvbikge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9ICghc2tpcE5vcm1hbGl6YXRpb24pID8gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSkgOiBmaWxlTmFtZVxuICAgICAgICBsb2cuZGVidWcoJ1todHRwIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZVBhdGgpXG5cbiAgICAgICAgdmFyIGlzQXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGlzQXN5bmMgPSBmYWxzZVxuICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCBmaWxlKSB7XG4gICAgICAgICAgICBpZiAoZXJyKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyKVxuXG4gICAgICAgICAgICByZXR1cm4gc3luY0ZpbGUgPSBmaWxlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgICAgLy8gVE9ETzogTmVlZHMgdmFsaWRhdGluZyB0aGF0IGV2ZW50IGhhbmRsZXJzIHdvcmsgYWNyb3NzIGJyb3dzZXJzLiBNb3JlIHNwZWNpZmljYWxseSwgdGhhdCB0aGV5IHJ1biBvbiBFUzUgZW52aXJvbm1lbnRzLlxuICAgICAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvWE1MSHR0cFJlcXVlc3QjQnJvd3Nlcl9jb21wYXRpYmlsaXR5XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IG5ldyB0aGlzLmJyb3dzZXIuc2NyaXB0RXZlbnRzKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuXG4gICAgICAgIHNjcmlwdFJlcXVlc3Qub3BlbignR0VUJywgZmlsZVBhdGgsIGlzQXN5bmMpXG4gICAgICAgIHNjcmlwdFJlcXVlc3Quc2VuZChudWxsKVxuXG4gICAgICAgIHJldHVybiBzeW5jRmlsZVxuICAgICAgfSxcblxuICAgICAgc2NyaXB0RXZlbnRzOiBmdW5jdGlvbihsb2FkZXIsIGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5maWxlTmFtZSA9IGZpbGVOYW1lXG4gICAgICAgIHRoaXMub25Mb2FkID0gbG9hZGVyLmJyb3dzZXIub25Mb2FkLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgICB0aGlzLm9uRXJyb3IgPSBsb2FkZXIuYnJvd3Nlci5vbkVycm9yLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgfSxcblxuICAgICAgb25Mb2FkOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IHRoaXNcblxuICAgICAgICAgIGlmIChzY3JpcHRSZXF1ZXN0LnN0YXR1cyA+IDQwMClcbiAgICAgICAgICAgIHJldHVybiBzY3JpcHRFdmVudHMub25FcnJvci5jYWxsKHNjcmlwdFJlcXVlc3QsIHNjcmlwdFJlcXVlc3Quc3RhdHVzVGV4dClcblxuICAgICAgICAgIGNvbnN0IHNjcmlwdENvbnRlbnQgPSBNb2R1bGUoc2NyaXB0UmVxdWVzdC5yZXNwb25zZVVSTCwgc2NyaXB0UmVxdWVzdC5yZXNwb25zZVRleHQsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcblxuICAgICAgICAgIHZhciBodG1sID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XG4gICAgICAgICAgdmFyIHNjcmlwdFRhZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpXG4gICAgICAgICAgc2NyaXB0VGFnLnRleHRDb250ZW50ID0gc2NyaXB0Q29udGVudFxuXG4gICAgICAgICAgaHRtbC5hcHBlbmRDaGlsZChzY3JpcHRUYWcpXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgb25FcnJvcjogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBzY3JpcHRFdmVudHMuZmlsZU5hbWVcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0VGFnID0gdGhpc1xuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG5cbiAgICAgICAgICAvLyBUcnkgdG8gZmFsbGJhY2sgdG8gaW5kZXguanNcbiAgICAgICAgICAvLyBGSVhNRTogaW5zdGVhZCBvZiBmYWxsaW5nIGJhY2ssIHRoaXMgc2hvdWxkIGJlIHRoZSBkZWZhdWx0IGlmIG5vIGAuanNgIGlzIGRldGVjdGVkLCBidXQgVVJMIHVnbGlmaWVycyBhbmQgc3VjaCB3aWxsIGhhdmUgaXNzdWVzLi4gaHJtbW1tLi5cbiAgICAgICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xICYmIGZpbGVOYW1lLmluZGV4T2YoJ2luZGV4LmpzJykgPT09IC0xKSB7XG4gICAgICAgICAgICBsb2cud2FybignW2h0dHBdIEF0dGVtcHRpbmcgdG8gZmFsbGJhY2sgdG86ICcsIGZpbGVOYW1lICsgJy9pbmRleC5qcycpXG4gICAgICAgICAgICByZXR1cm4gbG9hZGVyLmluLmNhbGwobG9hZGVyLCBmaWxlTmFtZSArICcvaW5kZXguanMnLCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKCdDb3VsZCBub3QgbG9hZCBCbHVlcHJpbnQnKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBjbGVhbnVwOiBmdW5jdGlvbihzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cykge1xuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuICAgICAgICAvL2RvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdoZWFkJylbMF0ucmVtb3ZlQ2hpbGQoc2NyaXB0VGFnKSAvLyBUT0RPOiBDbGVhbnVwXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICBub2RlOiB7XG4gICAgICAvLyBTdHViIGZvciBub2RlLmpzIEhUVFAgbG9hZGluZyBzdXBwb3J0LlxuICAgIH0sXG5cbiAgfSxcbn1cblxuZXhwb3J0ZXIoJ2h0dHAnLCBodHRwTG9hZGVyKSAvLyBUT0RPOiBDbGVhbnVwLCBleHBvc2UgbW9kdWxlcyBpbnN0ZWFkXG5cbmV4cG9ydCBkZWZhdWx0IGh0dHBMb2FkZXJcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcblxuLy8gRW1iZWRkZWQgZmlsZSBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgZmlsZUxvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvZmlsZScsXG4gIHByb3RvY29sOiAnZW1iZWQnLFxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdGaWxlIExvYWRlcicsXG4gICAgcHJvdG9jb2w6ICdmaWxlJyxcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICh0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlOi8vIGxvYWRpbmcgd2l0aGluIGJyb3dzZXIgbm90IHN1cHBvcnRlZCB5ZXQuIFRyeSByZWxhdGl2ZSBVUkwgaW5zdGVhZC4nKVxuXG4gICAgICBsb2cuZGVidWcoJ1tmaWxlIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZU5hbWUpXG5cbiAgICAgIC8vIFRPRE86IFN3aXRjaCB0byBhc3luYyBmaWxlIGxvYWRpbmcsIGltcHJvdmUgcmVxdWlyZSgpLCBwYXNzIGluIElJRkUgdG8gc2FuZGJveCwgdXNlIElJRkUgcmVzb2x2ZXIgZm9yIGNhbGxiYWNrXG4gICAgICAvLyBUT0RPOiBBZGQgZXJyb3IgcmVwb3J0aW5nLlxuXG4gICAgICBjb25zdCB2bSA9IHJlcXVpcmUoJ3ZtJylcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG5cbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnJlc29sdmVGaWxlKGZpbGVQYXRoKVxuICAgICAgaWYgKCFmaWxlKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ0JsdWVwcmludCBub3QgZm91bmQnKVxuXG4gICAgICBjb25zdCBmaWxlQ29udGVudHMgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZSkudG9TdHJpbmcoKVxuXG4gICAgICAvLyBUT0RPOiBDcmVhdGUgYSBtb3JlIGNvbXBsZXRlIHNhbmRib3ggb2JqZWN0XG4gICAgICBjb25zdCBzYW5kYm94ID0ge1xuICAgICAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgICAgIHJlcXVpcmU6IHJlcXVpcmUsXG4gICAgICAgIGNvbnNvbGU6IHsgbG9nOiBsb2csIGVycm9yOiBsb2cuZXJyb3IsIHdhcm46IGxvZy53YXJuIH1cbiAgICAgIH1cblxuICAgICAgdm0uY3JlYXRlQ29udGV4dChzYW5kYm94KVxuICAgICAgdm0ucnVuSW5Db250ZXh0KGZpbGVDb250ZW50cywgc2FuZGJveClcbiAgICAgIGNhbGxiYWNrKG51bGwsIHNhbmRib3guQmx1ZXByaW50KVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcbiAgICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcblxuICAgIHJlc29sdmVGaWxlOiBmdW5jdGlvbihmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG5cbiAgICAgIC8vIElmIGZpbGUgb3IgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIGJsdWVwcmludCBpcyBhIGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMoZmlsZVBhdGgpLmlzRGlyZWN0b3J5KCkpXG4gICAgICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShmaWxlUGF0aCwgJ2luZGV4LmpzJylcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHJldHVybiBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICB9XG5cbiAgICAgIC8vIFRyeSBhZGRpbmcgYW4gZXh0ZW5zaW9uIHRvIHNlZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSlcbiAgICAgICAgcmV0dXJuIGZpbGVcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgfSxcbn1cblxuXG5leHBvcnQgZGVmYXVsdCBmaWxlTG9hZGVyXG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBwcmVmZXItdGVtcGxhdGUgKi9cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgaHR0cExvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cCdcbmltcG9ydCBmaWxlTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlJ1xuXG4vLyBNdWx0aS1lbnZpcm9ubWVudCBhc3luYyBtb2R1bGUgbG9hZGVyXG5jb25zdCBtb2R1bGVzID0ge1xuICAnbG9hZGVycy9odHRwJzogaHR0cExvYWRlcixcbiAgJ2xvYWRlcnMvZmlsZSc6IGZpbGVMb2FkZXIsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5hbWUobmFtZSkge1xuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggZWFjaCBmaWxlIHBhdGggYW5kIG5vcm1hbGl6ZSBpdCB0b286XG4gIHJldHVybiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLy8uY2FwaXRhbGl6ZSgpXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVGaWxlSW5mbyhmaWxlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGaWxlTmFtZSA9IG5vcm1hbGl6ZU5hbWUoZmlsZSlcbiAgY29uc3QgcHJvdG9jb2wgPSBwYXJzZVByb3RvY29sKGZpbGUpXG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlOiBmaWxlLFxuICAgIHBhdGg6IGZpbGUsXG4gICAgbmFtZTogbm9ybWFsaXplZEZpbGVOYW1lLFxuICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVByb3RvY29sKG5hbWUpIHtcbiAgLy8gRklYTUU6IG5hbWUgc2hvdWxkIG9mIGJlZW4gbm9ybWFsaXplZCBieSBub3cuIEVpdGhlciByZW1vdmUgdGhpcyBjb2RlIG9yIG1vdmUgaXQgc29tZXdoZXJlIGVsc2UuLlxuICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsb2FkZXIgYmx1ZXByaW50IG5hbWUnKVxuXG4gIHZhciBwcm90b1Jlc3VsdHMgPSBuYW1lLm1hdGNoKC86XFwvXFwvL2dpKSAmJiBuYW1lLnNwbGl0KC86XFwvXFwvL2dpKVxuXG4gIC8vIE5vIHByb3RvY29sIGZvdW5kLCBpZiBicm93c2VyIGVudmlyb25tZW50IHRoZW4gaXMgcmVsYXRpdmUgVVJMIGVsc2UgaXMgYSBmaWxlIHBhdGguIChTYW5lIGRlZmF1bHRzIGJ1dCBjYW4gYmUgb3ZlcnJpZGRlbilcbiAgaWYgKCFwcm90b1Jlc3VsdHMpXG4gICAgcmV0dXJuICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyAnaHR0cCcgOiAnZmlsZSdcblxuICByZXR1cm4gcHJvdG9SZXN1bHRzWzBdXG59XG5cbmZ1bmN0aW9uIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpIHtcbiAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBtb2R1bGUuY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2sobW9kdWxlLm1vZHVsZSlcbiAgfVxuXG4gIG1vZHVsZS5jYWxsYmFja3MgPSBbXVxufVxuXG5jb25zdCBpbXBvcnRzID0gZnVuY3Rpb24obmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlSW5mbyA9IHJlc29sdmVGaWxlSW5mbyhuYW1lKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gZmlsZUluZm8ubmFtZVxuICAgIGNvbnN0IHByb3RvY29sID0gZmlsZUluZm8ucHJvdG9jb2xcblxuICAgIGxvZy5kZWJ1ZygnbG9hZGluZyBtb2R1bGU6JywgZmlsZU5hbWUpXG5cbiAgICAvLyBNb2R1bGUgaGFzIGxvYWRlZCBvciBzdGFydGVkIHRvIGxvYWRcbiAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0pXG4gICAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0ubG9hZGVkKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2sobW9kdWxlc1tmaWxlTmFtZV0ubW9kdWxlKSAvLyBSZXR1cm4gbW9kdWxlIGZyb20gQ2FjaGVcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG1vZHVsZXNbZmlsZU5hbWVdLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAvLyBOb3QgbG9hZGVkIHlldCwgcmVnaXN0ZXIgY2FsbGJhY2tcblxuICAgIG1vZHVsZXNbZmlsZU5hbWVdID0ge1xuICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxuICAgICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICAgICAgbG9hZGVkOiBmYWxzZSxcbiAgICAgIGNhbGxiYWNrczogW2NhbGxiYWNrXSxcbiAgICB9XG5cbiAgICAvLyBCb290c3RyYXBwaW5nIGxvYWRlciBibHVlcHJpbnRzIDspXG4gICAgLy9GcmFtZSgnTG9hZGVycy8nICsgcHJvdG9jb2wpLmZyb20oZmlsZU5hbWUpLnRvKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpIHt9KVxuXG4gICAgY29uc3QgbG9hZGVyID0gJ2xvYWRlcnMvJyArIHByb3RvY29sXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbml0KCkgLy8gVE9ETzogb3B0aW9uYWwgaW5pdCAoaW5zaWRlIEZyYW1lIGNvcmUpXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbihmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKXtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIGxvZy5lcnJvcignRXJyb3I6ICcsIGVyciwgZmlsZU5hbWUpXG4gICAgICBlbHNlIHtcbiAgICAgICAgbG9nLmRlYnVnKCdMb2FkZWQgQmx1ZXByaW50IG1vZHVsZTogJywgZmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKCFleHBvcnRGaWxlIHx8IHR5cGVvZiBleHBvcnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0RmlsZS5uYW1lICE9PSAnc3RyaW5nJylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBtaXNzaW5nIGEgbmFtZScpXG5cbiAgICAgICAgY29uc3QgbW9kdWxlID0gbW9kdWxlc1tmaWxlTmFtZV1cbiAgICAgICAgaWYgKCFtb2R1bGUpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVaCBvaCwgd2Ugc2hvdWxkbnQgYmUgaGVyZScpXG5cbiAgICAgICAgLy8gTW9kdWxlIGFscmVhZHkgbG9hZGVkLiBOb3Qgc3VwcG9zZSB0byBiZSBoZXJlLiBPbmx5IGZyb20gZm9yY2UtbG9hZGluZyB3b3VsZCBnZXQgeW91IGhlcmUuXG4gICAgICAgIGlmIChtb2R1bGUubG9hZGVkKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFwiJyArIGV4cG9ydEZpbGUubmFtZSArICdcIiBhbHJlYWR5IGxvYWRlZC4nKVxuXG4gICAgICAgIG1vZHVsZS5tb2R1bGUgPSBleHBvcnRGaWxlXG4gICAgICAgIG1vZHVsZS5sb2FkZWQgPSB0cnVlXG5cbiAgICAgICAgcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gVE9ETzogbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5idW5kbGUgc3VwcG9ydCBmb3IgQ0xJIHRvb2xpbmcuXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgbG9hZCBibHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBpbXBvcnRzXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuL2V4cG9ydHMnXG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycydcbmltcG9ydCBCbHVlcHJpbnRNZXRob2RzIGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCBCbHVlcHJpbnRCYXNlIGZyb20gJy4vQmx1ZXByaW50QmFzZSdcbmltcG9ydCBCbHVlcHJpbnRTY2hlbWEgZnJvbSAnLi9zY2hlbWEnXG5pbXBvcnQgaW1wb3J0cyBmcm9tICcuL2xvYWRlcidcblxuLy8gRnJhbWUgYW5kIEJsdWVwcmludCBjb25zdHJ1Y3RvcnNcbmNvbnN0IHNpbmdsZXRvbnMgPSB7fVxuZnVuY3Rpb24gRnJhbWUobmFtZSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRnJhbWUpKVxuICAgIHJldHVybiBuZXcgRnJhbWUobmFtZSwgb3B0cylcblxuICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG5hbWUgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nKVxuXG4gIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnQobmFtZSlcbiAgaW1wb3J0cyhuYW1lLCBvcHRzLCBmdW5jdGlvbihibHVlcHJpbnRGaWxlKSB7XG4gICAgdHJ5IHtcblxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgbG9hZGVkOicsIGJsdWVwcmludEZpbGUubmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBibHVlcHJpbnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgLy8gVXBkYXRlIGZhdXggYmx1ZXByaW50IHN0dWIgd2l0aCByZWFsIG1vZHVsZVxuICAgICAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlKVxuXG4gICAgICAvLyBVcGRhdGUgYmx1ZXByaW50IG5hbWVcbiAgICAgIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsIGJsdWVwcmludEZpbGUubmFtZSwgZmFsc2UpXG4gICAgICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IGJsdWVwcmludEZpbGUubmFtZVxuXG4gICAgICAvLyBBcHBseSBhIHNjaGVtYSB0byBibHVlcHJpbnRcbiAgICAgIGJsdWVwcmludCA9IEJsdWVwcmludFNjaGVtYShibHVlcHJpbnQpXG5cbiAgICAgIC8vIFZhbGlkYXRlIEJsdWVwcmludCBpbnB1dCB3aXRoIG9wdGlvbmFsIHByb3BlcnR5IGRlc3RydWN0dXJpbmcgKHVzaW5nIGRlc2NyaWJlIG9iamVjdClcbiAgICAgIGJsdWVwcmludC5GcmFtZS5kZXNjcmliZSA9IGhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUoYmx1ZXByaW50LmRlc2NyaWJlLCBCbHVlcHJpbnRCYXNlLmRlc2NyaWJlKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpXG4gIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdCbHVlcHJpbnQnLCB0cnVlKVxuXG4gIC8vIEJsdWVwcmludCBtZXRob2RzXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICAvLyBDcmVhdGUgaGlkZGVuIGJsdWVwcmludC5GcmFtZSBwcm9wZXJ0eSB0byBrZWVwIHN0YXRlXG4gIGNvbnN0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gICAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEZyYW1lKG5hbWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0gYXJndW1lbnRzXG5cbiAgICByZXR1cm4gYmx1ZXByaW50XG4gIH1cbn1cblxuLy8gR2l2ZSBGcmFtZSBhbiBlYXN5IGRlc2NyaXB0b3JcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZSwgJ0NvbnN0cnVjdG9yJylcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZS5jb25zdHJ1Y3RvciwgJ0ZyYW1lJylcblxuLy8gRXhwb3J0IEZyYW1lIGdsb2JhbGx5XG5leHBvcnRlcignRnJhbWUnLCBGcmFtZSlcbmV4cG9ydCBkZWZhdWx0IEZyYW1lXG4iXSwibmFtZXMiOlsiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCO0VBQ0EsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3RDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLElBQUksR0FBRyxXQUFXO0VBQ3RCO0VBQ0EsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3JDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQ25CRDtFQUNBO0VBQ0EsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtFQUM3QjtFQUNBLEVBQUUsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLENBQUMsT0FBTyxLQUFLLFFBQVE7RUFDdEUsSUFBSSxNQUFNLENBQUMsT0FBTyxHQUFHLElBQUc7O0VBRXhCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVE7RUFDaEMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBRzs7RUFFdEI7RUFDQSxPQUFPLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxJQUFJLE1BQU0sQ0FBQyxHQUFHO0VBQ3JELElBQUksTUFBTSxDQUFDLENBQUMsU0FBUyxDQUFDLEVBQUUsU0FBUyxHQUFHLEVBQUU7RUFDdEMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBRztFQUNyQixLQUFLLEVBQUM7O0VBRU47RUFDQSxPQUFPLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtFQUNyQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHO0VBQ3RCLENBQUM7O0VDbEJEO0VBQ0EsU0FBUyxZQUFZLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRTtFQUN0QyxFQUFFLEtBQUssTUFBTSxZQUFZLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxFQUFFO0VBQ2pFLElBQUksSUFBSSxZQUFZLEtBQUssTUFBTTtFQUMvQixNQUFNLFFBQVE7O0VBRWQsSUFBSSxJQUFJLE9BQU8sTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLFFBQVE7RUFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0VBQzdDLFFBQVEsTUFBTSxDQUFDLFlBQVksQ0FBQyxHQUFHLEdBQUU7RUFDakM7RUFDQSxRQUFRLE1BQU0sQ0FBQyxZQUFZLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxNQUFNLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLEVBQUM7RUFDMUg7RUFDQSxNQUFNLE1BQU0sQ0FBQyxjQUFjO0VBQzNCLFFBQVEsTUFBTTtFQUNkLFFBQVEsWUFBWTtFQUNwQixRQUFRLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDO0VBQzdELFFBQU87RUFDUCxHQUFHOztFQUVILEVBQUUsT0FBTyxNQUFNO0VBQ2YsQ0FBQzs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRTtFQUNwRCxFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRTtFQUM1QyxJQUFJLFVBQVUsRUFBRSxLQUFLO0VBQ3JCLElBQUksUUFBUSxFQUFFLEtBQUs7RUFDbkIsSUFBSSxZQUFZLEVBQUUsSUFBSTtFQUN0QixJQUFJLEtBQUssRUFBRSxXQUFXO0VBQ3RCLE1BQU0sT0FBTyxDQUFDLEtBQUssSUFBSSxVQUFVLEdBQUcsS0FBSyxHQUFHLEdBQUcsR0FBRyxzQkFBc0I7RUFDeEUsS0FBSztFQUNMLEdBQUcsRUFBQzs7RUFFSixFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRTtFQUN4QyxJQUFJLFVBQVUsRUFBRSxLQUFLO0VBQ3JCLElBQUksUUFBUSxFQUFFLEtBQUs7RUFDbkIsSUFBSSxZQUFZLEVBQUUsQ0FBQyxZQUFZLElBQUksSUFBSSxHQUFHLEtBQUs7RUFDL0MsSUFBSSxLQUFLLEVBQUUsS0FBSztFQUNoQixHQUFHLEVBQUM7RUFDSixDQUFDOztFQUVEO0VBQ0EsU0FBUyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFO0VBQ3pDLEVBQUUsTUFBTSxNQUFNLEdBQUcsR0FBRTs7RUFFbkI7RUFDQSxFQUFFLElBQUksQ0FBQyxNQUFNO0VBQ2IsSUFBSSxNQUFNLEdBQUcsR0FBRTs7RUFFZjtFQUNBLEVBQUUsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUU7RUFDMUIsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRTtFQUNwQixHQUFHOztFQUVIO0VBQ0EsRUFBRSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUU7RUFDekMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRTs7RUFFcEI7RUFDQSxJQUFJLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0VBQ3JFLE1BQU0sUUFBUTs7RUFFZDtFQUNBOztFQUVBLElBQUksTUFBTSxTQUFTLEdBQUcsR0FBRTtFQUN4QixJQUFJLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUNqRCxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBQztFQUNwRSxLQUFLOztFQUVMLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFVBQVM7RUFDM0IsR0FBRzs7RUFFSCxFQUFFLE9BQU8sTUFBTTtFQUNmLENBQUM7O0VBRUQsU0FBUyxXQUFXLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRTtFQUNwQyxFQUFFLE1BQU0sV0FBVyxHQUFHLENBQUMsQ0FBQyxLQUFLLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFDOztFQUV2RCxFQUFFLElBQUksQ0FBQyxNQUFNO0VBQ2IsSUFBSSxPQUFPLFdBQVc7O0VBRXRCLEVBQUUsTUFBTSxXQUFXLEdBQUcsR0FBRTtFQUN4QixFQUFFLElBQUksU0FBUyxHQUFHLEVBQUM7O0VBRW5CO0VBQ0EsRUFBRSxLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sRUFBRTtFQUNuQyxJQUFJLFdBQVcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLFNBQVMsRUFBQztFQUN6RCxJQUFJLFNBQVMsR0FBRTtFQUNmLEdBQUc7O0VBRUg7RUFDQSxFQUFFLElBQUksU0FBUyxLQUFLLENBQUM7RUFDckIsSUFBSSxPQUFPLEtBQUs7O0VBRWhCO0VBQ0EsRUFBRSxPQUFPLFdBQVc7RUFDcEIsQ0FBQzs7RUM3RkQsU0FBUyxXQUFXLEdBQUc7O0lBRXJCLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjO01BQzNCLE1BQU07OztJQUdSLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7TUFDN0IsTUFBTTs7O0lBR1IsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO01BQ3hCLE1BQU07SUFJUixJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxLQUFJOzs7SUFHaEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUM7OztJQUczRCxJQUFJLENBQUMsR0FBRyxFQUFDO0lBQ1QsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRTtNQUNuQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsT0FBTTs7TUFFN0IsSUFBSSxJQUFJLENBQUMsU0FBUyxLQUFLLE1BQU0sRUFBRTtRQUM3QixJQUFJLE9BQU8sU0FBUyxDQUFDLEVBQUUsS0FBSyxVQUFVO1VBQ3BDLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQyxJQUFJLEdBQUcsNkJBQTZCLENBQUM7OztRQUdsRixJQUFJLENBQUMsT0FBTyxHQUFHLGFBQWEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUM7UUFDbEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQzs7T0FFN0IsTUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSSxFQUFFO1FBQ2xDLElBQUksT0FBTyxTQUFTLENBQUMsRUFBRSxLQUFLLFVBQVU7VUFDcEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFDLElBQUksR0FBRyw0QkFBNEIsQ0FBQzs7UUFFakYsSUFBSSxDQUFDLE9BQU8sR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFDO1FBQ2xELElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUM7UUFDMUIsQ0FBQyxHQUFFO09BQ0o7S0FDRjs7SUFFRCxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQztHQUNyQjs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRTtJQUMvQyxPQUFPO01BQ0wsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJO01BQ3BCLEtBQUssRUFBRSxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUs7TUFDNUIsR0FBRyxFQUFFLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUM7TUFDdEMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUM7S0FDM0M7R0FDRjs7RUFFRCxTQUFTLFVBQVUsR0FBRzs7SUFFcEIsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFO01BQzNCLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBQztNQUNyQyxPQUFPLEtBQUs7S0FDYjs7O0lBR0QsSUFBSSxVQUFVLEdBQUcsS0FBSTtJQUNyQixLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFO01BQ25DLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxPQUFNOzs7TUFHMUIsSUFBSSxNQUFNLENBQUMsSUFBSTtRQUNiLFFBQVE7O01BRVYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFO1FBQ3hCLFVBQVUsR0FBRyxNQUFLO1FBQ2xCLFFBQVE7T0FDVDs7TUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUU7UUFDN0IsYUFBYSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBQztRQUNsRCxVQUFVLEdBQUcsTUFBSztRQUNsQixRQUFRO09BQ1Q7S0FDRjs7SUFFRCxPQUFPLFVBQVU7R0FDbEI7O0VBRUQsU0FBUyxTQUFTLEdBQUc7O0lBR25CLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUU7TUFDckMsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU07TUFDOUIsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsTUFBTSxFQUFDOzs7TUFHcEUsSUFBSSxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUMzRCxDQUEwRjtXQUN2RixJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxjQUFjO1FBQ3RDLFNBQVMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFDO0tBQzFDO0dBQ0Y7O0VBRUQsU0FBUyxhQUFhLENBQUMsUUFBUSxFQUFFO0lBQy9CLE1BQU0sU0FBUyxHQUFHLEtBQUk7O0lBRXRCLElBQUk7TUFDRixJQUFJLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxHQUFFOzs7TUFHOUQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJO1FBQ2pCLFNBQVMsQ0FBQyxJQUFJLEdBQUcsU0FBUyxDQUFDLEVBQUUsSUFBSSxFQUFFO1VBQ2pDLElBQUksR0FBRTtVQUNQOztNQUVILEtBQUssR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBQztNQUN6RCxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLFNBQVMsR0FBRyxFQUFFO1FBQ2xELElBQUksR0FBRztVQUNMLE9BQU8sR0FBRyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsR0FBRyxTQUFTLENBQUMsSUFBSSxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUM7Ozs7UUFLckYsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsR0FBRTtRQUMxQixTQUFTLENBQUMsS0FBSyxDQUFDLFdBQVcsR0FBRyxLQUFJO1FBQ2xDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFDLEVBQUUsRUFBRSxDQUFDLEVBQUM7T0FDbkUsRUFBQzs7S0FFSCxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFDLElBQUksR0FBRyw0QkFBNEIsR0FBRyxHQUFHLENBQUM7S0FDdEY7R0FDRjs7O0VDL0hELE1BQU0sZ0JBQWdCLEdBQUc7SUFDdkIsRUFBRSxFQUFFLFNBQVMsTUFBTSxFQUFFO01BQ25CLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUN4RTs7SUFFRCxJQUFJLEVBQUUsU0FBUyxNQUFNLEVBQUU7TUFDckIsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQzFFOztJQUVELEdBQUcsRUFBRSxTQUFTLEtBQUssRUFBRSxJQUFJLEVBQUU7TUFFekIsS0FBSyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFDO0tBQzNDOztJQUVELEtBQUssRUFBRSxTQUFTLEtBQUssRUFBRSxHQUFHLEVBQUU7TUFDMUIsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksR0FBRyxTQUFTLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBQztNQUM1RCxLQUFLLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBQztLQUNwQzs7SUFFRCxJQUFJLEtBQUssR0FBRzs7TUFFVixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7UUFDYixPQUFPLEVBQUU7O01BRVgsTUFBTSxTQUFTLEdBQUcsS0FBSTtNQUN0QixNQUFNLGVBQWUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxTQUFTLE9BQU8sRUFBRSxNQUFNLEVBQUU7UUFDNUQsU0FBUyxDQUFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSTtRQUNqQyxTQUFTLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sR0FBRTtPQUMvRCxFQUFDO01BQ0YsT0FBTyxlQUFlO0tBQ3ZCO0lBQ0Y7OztFQUdELFNBQVMsYUFBYSxDQUFDLE1BQU0sRUFBRTtJQUM3QixNQUFNLFNBQVMsR0FBRyxHQUFFO0lBQ3BCLFlBQVksQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUM7O0lBRXpDLFNBQVMsQ0FBQyxJQUFJLEdBQUcsS0FBSTtJQUNyQixTQUFTLENBQUMsS0FBSyxHQUFHO01BQ2hCLE9BQU8sRUFBRSxFQUFFO01BQ1gsUUFBUSxFQUFFLEVBQUU7TUFDYjs7SUFFRCxJQUFJLE9BQU8sTUFBTSxLQUFLLFVBQVUsRUFBRTtNQUNoQyxhQUFhLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBQztNQUNwQyxTQUFTLENBQUMsRUFBRSxHQUFHLE9BQU07TUFDckIsU0FBUyxDQUFDLEVBQUUsR0FBRyxPQUFNO0tBQ3RCLE1BQU07TUFDTCxhQUFhLENBQUMsU0FBUyxFQUFFLFdBQVcsRUFBQztNQUNyQyxTQUFTLENBQUMsRUFBRSxHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7UUFFekMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUM7UUFDakI7TUFDRCxTQUFTLENBQUMsRUFBRSxHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7UUFFekMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUM7UUFDakI7S0FDRjs7SUFFRCxPQUFPLFNBQVM7R0FDakI7O0VBRUQsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFO0lBQzdDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFJO0lBQ3RCLFlBQVksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBQztJQUM1QyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFVLENBQUMsV0FBVztNQUNyRCxPQUFPLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksRUFBQztNQUNyQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUM7S0FDNUIsRUFBRSxJQUFJLEVBQUM7R0FDVDs7RUFFRCxTQUFTLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRTtJQUNwQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLO01BQ3hCLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLEdBQUU7OztJQUc1QixJQUFJLGFBQWEsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFNO0lBQ2hELFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVzs7TUFFL0MsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFDO0tBQzVCLEVBQUUsQ0FBQyxDQUFDLEVBQUM7R0FDUDs7RUFFRCxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDbkIsT0FBTyxXQUFXO01BQ2hCLE9BQU8sRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDO0tBQ2pDO0dBQ0Y7OztFQUdELFNBQVMsT0FBTyxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFO0lBQzFDLElBQUksQ0FBQyxJQUFJO01BQ1AsTUFBTSxJQUFJLEtBQUssQ0FBQyxvRkFBb0YsQ0FBQzs7SUFFdkcsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUs7TUFDbEMsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQzs7SUFFOUQsSUFBSSxDQUFDLE1BQU07TUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLEdBQUcsR0FBRyxTQUFTLEdBQUcsd0NBQXdDLENBQUM7O0lBRS9GLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsS0FBSyxVQUFVLEVBQUU7TUFDbkUsTUFBTSxHQUFHLGFBQWEsQ0FBQyxNQUFNLEVBQUM7S0FDL0IsTUFBTSxJQUFJLE9BQU8sTUFBTSxLQUFLLFVBQVUsRUFBRTtNQUN2QyxNQUFNLEdBQUcsYUFBYSxDQUFDLE1BQU0sRUFBQztLQUMvQjs7O0lBR0QsSUFBSSxTQUFTLEdBQUcsS0FBSTtJQUNwQixJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUU7TUFDN0IsU0FBUyxHQUFHLFNBQVMsR0FBRTs7TUFFdkIsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFLO01BQ3hDLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBSztNQUN4QyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsR0FBRyxLQUFJO0tBQ2hDO0lBR0QsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBQzs7O0lBR3BGLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxLQUFLO01BQ3hCLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsRUFBQzs7SUFFbEQsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFDO0lBQ25DLE9BQU8sU0FBUztHQUNqQjs7RUFFRCxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRTtJQUVsQyxJQUFJLEdBQUcsRUFBRTtNQUNQLEdBQUcsQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsR0FBRyxFQUFDO01BQ3JDLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxHQUFHLE1BQUs7TUFDakMsTUFBTTtLQUNQOztJQUVELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSTtJQUM1QixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxFQUFDOzs7SUFHeEIsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7TUFDekIsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsTUFBSzs7TUFFakMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtRQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ2hDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxHQUFHLE1BQUs7T0FDOUI7OztNQUdELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBTztNQUNsQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ3RCLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFO1VBQzVCLElBQUksU0FBUyxHQUFHLE1BQU0sQ0FBQyxPQUFNO1VBRTdCLEtBQUssQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsRUFBQztTQUM1QztPQUNGOztNQUVELE9BQU8sTUFBb0Q7S0FDNUQ7O0lBRUQsUUFBUSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUM7R0FDckI7O0VBRUQsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRTtJQUM1QixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsT0FBTTtJQUM3QixNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUM7SUFDbkUsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQU87SUFDNUIsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFDO0lBQ2pHLE1BQU0sT0FBTyxHQUFHLE9BQU8sU0FBUTs7O0lBRy9CLElBQUksT0FBTyxLQUFLLFdBQVc7TUFDekIsTUFBTTs7SUFFUixJQUFJLE9BQU8sS0FBSyxRQUFRLElBQUksUUFBUSxZQUFZLE9BQU8sRUFBRTs7TUFFdkQsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUM7S0FDaEQsTUFBTSxJQUFJLE9BQU8sS0FBSyxRQUFRLElBQUksUUFBUSxZQUFZLEtBQUssRUFBRTs7TUFFNUQsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUM7S0FDeEIsTUFBTTs7TUFFTCxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBQztLQUN0QjtHQUNGOztFQUVELFNBQVMsWUFBWSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUU7SUFDL0IsSUFBSSxHQUFHO01BQ0wsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQzs7SUFFeEIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQztHQUN0Qjs7RUNyTUQ7RUFDQSxNQUFNLGFBQWEsR0FBRztFQUN0QixFQUFFLElBQUksRUFBRSxFQUFFO0VBQ1YsRUFBRSxRQUFRLEVBQUUsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQztFQUNqQyxFQUFFLEtBQUssRUFBRSxFQUFFO0VBQ1gsRUFBRSxLQUFLLEVBQUUsRUFBRTs7RUFFWCxFQUFFLE1BQU0sRUFBRSxLQUFLO0VBQ2YsRUFBRSxXQUFXLEVBQUUsS0FBSztFQUNwQixFQUFFLGNBQWMsRUFBRSxLQUFLO0VBQ3ZCLEVBQUUsUUFBUSxFQUFFLEVBQUU7RUFDZCxFQUFFLE9BQU8sRUFBRSxFQUFFOztFQUViLEVBQUUsUUFBUSxFQUFFLEtBQUs7RUFDakIsRUFBRSxLQUFLLEVBQUUsRUFBRTtFQUNYLEVBQUUsTUFBTSxFQUFFLEVBQUU7RUFDWixFQUFFLElBQUksRUFBRSxFQUFFO0VBQ1YsQ0FBQzs7RUNqQkQ7RUFDQSxTQUFTLFdBQVcsQ0FBQyxTQUFTLEVBQUU7RUFDaEMsRUFBRSxJQUFJLE9BQU8sU0FBUyxLQUFLLFVBQVUsRUFBRTtFQUN2QyxJQUFJLE9BQU8sRUFBRSxJQUFJLEVBQUUsU0FBUyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFO0VBQ3ZELEdBQUcsTUFBTSxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVE7RUFDMUMsSUFBSSxTQUFTLEdBQUcsR0FBRTs7RUFFbEI7RUFDQSxFQUFFLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFDO0VBQ3pDLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFDOztFQUVsQztFQUNBLEVBQUUsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO0VBQ3pDO0VBQ0EsSUFBSSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFVBQVU7RUFDekMsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFFO0VBQ2xFLFNBQVMsSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUM1RSxNQUFNLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxHQUFHLEVBQUM7RUFDbkMsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsR0FBRTtFQUNwRSxNQUFNLEtBQUssTUFBTSxVQUFVLElBQUksU0FBUyxFQUFFO0VBQzFDLFFBQVEsSUFBSSxPQUFPLFVBQVUsS0FBSyxVQUFVO0VBQzVDLFVBQVUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxVQUFVLEVBQUUsRUFBQztFQUNyRCxPQUFPO0VBQ1AsS0FBSyxNQUFNLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUU7RUFDcEUsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxHQUFFO0VBQzVGLEtBQUssTUFBTTtFQUNYLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUU7RUFDaEUsS0FBSztFQUNMLEdBQUc7O0VBRUg7RUFDQSxFQUFFLFNBQVMsYUFBYSxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUU7RUFDckM7RUFDQTtFQUNBLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUM7RUFDcEIsTUFBTSxPQUFPLElBQUk7O0VBRWpCLElBQUksSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUU7RUFDbkUsTUFBTSxPQUFPLElBQUk7RUFDakIsS0FBSyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFO0VBQ3pFLE1BQU0sSUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssQ0FBQztFQUM1RCxRQUFRLE9BQU8sS0FBSzs7RUFFcEIsTUFBTSxPQUFPLElBQUk7RUFDakIsS0FBSyxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ3pELE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEtBQUssVUFBVSxFQUFFO0VBQ3JELFFBQVEsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztFQUN6QyxPQUFPO0VBQ1AsS0FBSzs7RUFFTCxJQUFJLE9BQU8sS0FBSztFQUNoQixHQUFHOztFQUVIO0VBQ0EsRUFBRSxPQUFPLFNBQVMsY0FBYyxDQUFDLGFBQWEsRUFBRTtFQUNoRCxJQUFJLE1BQU0sUUFBUSxHQUFHLEdBQUU7RUFDdkIsSUFBSSxNQUFNLEdBQUcsR0FBRyxjQUFhOztFQUU3QixJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLGFBQWEsQ0FBQyxFQUFFO0VBQ2pFLE1BQU0sTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLHdCQUF3QixDQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUM7O0VBRWhGO0VBQ0EsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxZQUFZLEVBQUU7RUFDcEUsUUFBUSxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsY0FBYyxFQUFDO0VBQ3ZELFFBQVEsUUFBUTtFQUNoQixPQUFPOztFQUVQO0VBQ0EsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0VBQ3hCLFFBQVEsTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLGNBQWMsRUFBQztFQUN2RCxRQUFRLFFBQVE7RUFDaEIsT0FBTzs7RUFFUCxNQUFNLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxhQUFhLENBQUMsR0FBRyxFQUFDO0VBQ3hDLE1BQU0sTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFO0VBQ3RDLFFBQVEsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVO0VBQzdDLFFBQVEsWUFBWSxFQUFFLGNBQWMsQ0FBQyxZQUFZO0VBQ2pELFFBQVEsR0FBRyxFQUFFLFdBQVc7RUFDeEIsVUFBVSxPQUFPLFFBQVEsQ0FBQyxHQUFHLENBQUM7RUFDOUIsU0FBUzs7RUFFVCxRQUFRLEdBQUcsRUFBRSxTQUFTLEtBQUssRUFBRTtFQUM3QixVQUFVLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFO0VBQzFDLFlBQVksSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFO0VBQ3JDLGNBQWMsS0FBSyxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssR0FBRyxPQUFPLE1BQUs7RUFDeEUsY0FBYyxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsV0FBVyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDOUcsYUFBYSxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUU7RUFDeEQsY0FBYyxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsa0JBQWtCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQzdILGFBQWE7RUFDYixjQUFjLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLEdBQUcsR0FBRyxhQUFhLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksR0FBRyxVQUFVLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQ3ZILFdBQVc7O0VBRVgsVUFBVSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsTUFBSztFQUMvQixVQUFVLE9BQU8sS0FBSztFQUN0QixTQUFTO0VBQ1QsT0FBTyxFQUFDOztFQUVSO0VBQ0EsTUFBTSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUM1RCxRQUFRLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQztFQUNwQixVQUFVLFFBQVE7O0VBRWxCLFFBQVEsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxHQUFHLEVBQUM7RUFDMUMsUUFBUSxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUU7RUFDeEMsVUFBVSxVQUFVLEVBQUUsY0FBYyxDQUFDLFVBQVU7RUFDL0MsVUFBVSxZQUFZLEVBQUUsY0FBYyxDQUFDLFlBQVk7RUFDbkQsVUFBVSxHQUFHLEVBQUUsV0FBVztFQUMxQixZQUFZLE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQztFQUNoQyxXQUFXOztFQUVYLFVBQVUsR0FBRyxFQUFFLFNBQVMsS0FBSyxFQUFFO0VBQy9CLFlBQVksSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUU7RUFDNUMsY0FBYyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUU7RUFDdkMsZ0JBQWdCLEtBQUssR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEdBQUcsT0FBTyxNQUFLO0VBQzFFLGdCQUFnQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsV0FBVyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDaEgsZUFBZSxNQUFNLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUU7RUFDMUQsZ0JBQWdCLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLEdBQUcsR0FBRyxrQkFBa0IsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBRyxPQUFPLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDL0gsZUFBZTtFQUNmLGdCQUFnQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsYUFBYSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLE9BQU8sS0FBSyxHQUFHLEdBQUcsQ0FBQztFQUN6SCxhQUFhOztFQUViLFlBQVksUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQUs7RUFDakMsWUFBWSxPQUFPLEtBQUs7RUFDeEIsV0FBVztFQUNYLFNBQVMsRUFBQztFQUNWLE9BQU87O0VBRVAsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsYUFBYSxDQUFDLEdBQUcsRUFBQztFQUNuQyxLQUFLOztFQUVMLElBQUksT0FBTyxHQUFHO0VBQ2QsR0FBRztFQUNILENBQUM7O0VBRUQsV0FBVyxDQUFDLGNBQWMsR0FBRyxXQUFXLENBQUMsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0VBQ3RFLEVBQUUsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRO0VBQzdCLElBQUksT0FBTyxLQUFLOztFQUVoQixFQUFFLE9BQU8sR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDO0VBQzlCLENBQUMsQ0FBQzs7RUN6SUY7RUFDQSxNQUFNLGVBQWUsR0FBRyxJQUFJLFdBQVcsQ0FBQztFQUN4QyxFQUFFLElBQUksRUFBRSxXQUFXLENBQUMsY0FBYzs7RUFFbEM7RUFDQSxFQUFFLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNsQixFQUFFLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNoQixFQUFFLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQztFQUNoQixFQUFFLFFBQVEsRUFBRSxDQUFDLE1BQU0sQ0FBQzs7RUFFcEI7RUFDQSxFQUFFLEdBQUcsRUFBRSxRQUFRO0VBQ2YsRUFBRSxLQUFLLEVBQUUsUUFBUTtFQUNqQixFQUFFLEtBQUssRUFBRSxDQUFDLFFBQVEsQ0FBQzs7RUFFbkI7RUFDQSxFQUFFLEVBQUUsRUFBRSxRQUFRO0VBQ2QsRUFBRSxJQUFJLEVBQUUsUUFBUTtFQUNoQixDQUFDLENBQUM7O0VDdEJGOztFQUVBLFNBQVMsTUFBTSxDQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFFO0VBQ3BEO0VBQ0EsRUFBRSxJQUFJLENBQUMsWUFBWTtFQUNuQixJQUFJLFVBQVUsR0FBRyxVQUFVLENBQUMsSUFBSSxJQUFJLEdBQUU7O0VBRXRDLEVBQUUsSUFBSSxNQUFNLEdBQUc7RUFDZixJQUFJLFFBQVEsRUFBRSxVQUFVO0VBQ3hCLElBQUksT0FBTyxFQUFFLEVBQUU7RUFDZixJQUFJLFNBQVMsRUFBRSxJQUFJO0VBQ25CLElBQUksT0FBTyxFQUFFLEVBQUU7O0VBRWYsSUFBSSxPQUFPLEVBQUUsU0FBUyxHQUFHLEVBQUUsUUFBUSxFQUFFO0VBQ3JDLE1BQU0sSUFBSSxTQUFROztFQUVsQixNQUFNLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtFQUNwQyxRQUFRLFFBQVEsR0FBRyxJQUFHO0VBQ3RCLE9BQU8sTUFBTTtFQUNiLFFBQVEsUUFBUSxHQUFHLGtCQUFrQixHQUFHLElBQUc7RUFDM0MsT0FBTzs7RUFFUCxNQUFNLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUM7RUFDM0YsS0FBSztFQUNMLElBQUc7O0VBRUgsRUFBRSxJQUFJLENBQUMsUUFBUTtFQUNmLElBQUksT0FBTyxNQUFNOztFQUVqQixFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLFNBQVMsT0FBTyxFQUFFO0VBQ3RELElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7RUFDM0IsSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBQztFQUMxQyxJQUFHOztFQUVILEVBQUUsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLEdBQUcsVUFBVSxHQUFHLDRCQUE0QjtFQUMvRSxFQUFFLHFDQUFxQztFQUN2QyxFQUFFLHNDQUFzQztFQUN4QyxFQUFFLHNFQUFzRTtFQUN4RSxFQUFFLGtDQUFrQztFQUNwQyxFQUFFLGtDQUFrQztFQUNwQyxFQUFFLHFDQUFxQztFQUN2QyxFQUFFLDZCQUE2Qjs7RUFFL0IsRUFBRSxpQkFBaUI7RUFDbkIsRUFBRSxpQkFBaUI7RUFDbkIsSUFBSSxZQUFZLEdBQUcsSUFBSTtFQUN2QixFQUFFLDRCQUE0QjtFQUM5QixFQUFFLHdDQUF3QztFQUMxQyxFQUFFLDJCQUEyQjtFQUM3QixFQUFFLGNBQWE7O0VBRWYsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07RUFDeEIsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07RUFDeEIsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU07O0VBRXhCLEVBQUUsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsUUFBTzs7RUFFakMsRUFBRSxPQUFPLE1BQU07RUFDZixDQUFDOzs7RUNyREQsTUFBTSxVQUFVLEdBQUc7SUFDakIsSUFBSSxFQUFFLGNBQWM7SUFDcEIsUUFBUSxFQUFFLFFBQVE7OztJQUdsQixNQUFNLEVBQUUsSUFBSTtJQUNaLFNBQVMsRUFBRSxFQUFFOztJQUViLE1BQU0sRUFBRTtNQUNOLElBQUksRUFBRSxhQUFhO01BQ25CLFFBQVEsRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDOztNQUVyQyxJQUFJLEVBQUUsV0FBVztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsQ0FBQyxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksSUFBSSxHQUFHLE1BQUs7T0FDN0Q7O01BRUQsRUFBRSxFQUFFLFNBQVMsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsaUJBQWlCLEVBQUU7UUFDeEQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTO1VBQ2pCLE9BQU8sUUFBUSxDQUFDLDREQUE0RCxDQUFDOztRQUUvRSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQztPQUMzRTs7TUFFRCxpQkFBaUIsRUFBRSxTQUFTLFFBQVEsRUFBRTtRQUNwQyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztVQUMvQixPQUFPLFFBQVE7O1FBRWpCLE1BQU0sSUFBSSxHQUFHLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLEVBQUUsRUFBQztRQUN2RSxNQUFNLFFBQVEsR0FBRyxhQUFhLEdBQUcsS0FBSTtRQUNyQyxPQUFPLFFBQVE7T0FDaEI7O01BRUQsT0FBTyxFQUFFO1FBQ1AsSUFBSSxFQUFFLFNBQVMsUUFBUSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsRUFBRTtVQUNwRCxNQUFNLFFBQVEsR0FBRyxDQUFDLENBQUMsaUJBQWlCLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxHQUFHLFNBQVE7O1VBR25GLElBQUksT0FBTyxHQUFHLEtBQUk7VUFDbEIsSUFBSSxRQUFRLEdBQUcsS0FBSTtVQUNuQixJQUFJLENBQUMsUUFBUSxFQUFFO1lBQ2IsT0FBTyxHQUFHLE1BQUs7WUFDZixRQUFRLEdBQUcsU0FBUyxHQUFHLEVBQUUsSUFBSSxFQUFFO2NBQzdCLElBQUksR0FBRztnQkFDTCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQzs7Y0FFdEIsT0FBTyxRQUFRLEdBQUcsSUFBSTtjQUN2QjtXQUNGOztVQUVELE1BQU0sYUFBYSxHQUFHLElBQUksY0FBYyxHQUFFOzs7O1VBSTFDLE1BQU0sWUFBWSxHQUFHLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUM7VUFDNUUsYUFBYSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUMsTUFBTSxFQUFDO1VBQzNELGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLE9BQU8sRUFBQzs7VUFFN0QsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBQztVQUM1QyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQzs7VUFFeEIsT0FBTyxRQUFRO1NBQ2hCOztRQUVELFlBQVksRUFBRSxTQUFTLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFO1VBQ2pELElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUTtVQUN4QixJQUFJLENBQUMsUUFBUSxHQUFHLFNBQVE7VUFDeEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBQztVQUN0RCxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFDO1NBQ3pEOztRQUVELE1BQU0sRUFBRSxTQUFTLE1BQU0sRUFBRTtVQUN2QixNQUFNLFlBQVksR0FBRyxLQUFJO1VBQ3pCLE9BQU8sV0FBVztZQUNoQixNQUFNLGFBQWEsR0FBRyxLQUFJOztZQUUxQixJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsR0FBRztjQUM1QixPQUFPLFlBQVksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsVUFBVSxDQUFDOztZQUUzRSxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDLFdBQVcsRUFBRSxhQUFhLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQyxRQUFRLEVBQUM7O1lBRTFHLElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQyxnQkFBZTtZQUNuQyxJQUFJLFNBQVMsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBQztZQUNoRCxTQUFTLENBQUMsV0FBVyxHQUFHLGNBQWE7O1lBRXJDLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFDO1lBQzNCLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxZQUFZLEVBQUM7V0FDaEQ7U0FDRjs7UUFFRCxPQUFPLEVBQUUsU0FBUyxNQUFNLEVBQUU7VUFDeEIsTUFBTSxZQUFZLEdBQUcsS0FBSTtVQUN6QixNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsU0FBUTs7VUFFdEMsT0FBTyxXQUFXO1lBQ2hCLE1BQU0sU0FBUyxHQUFHLEtBQUk7WUFDdEIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLFlBQVksRUFBQzs7OztZQUkvQyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtjQUN6RSxHQUFHLENBQUMsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLFFBQVEsR0FBRyxXQUFXLEVBQUM7Y0FDdEUsT0FBTyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBRSxZQUFZLENBQUMsUUFBUSxDQUFDO2FBQzdFOztZQUVELFlBQVksQ0FBQyxRQUFRLENBQUMsMEJBQTBCLEVBQUM7V0FDbEQ7U0FDRjs7UUFFRCxPQUFPLEVBQUUsU0FBUyxTQUFTLEVBQUUsWUFBWSxFQUFFO1VBQ3pDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBQztVQUMxRCxTQUFTLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQyxPQUFPLEVBQUM7O1NBRTdEO09BQ0Y7O01BRUQsSUFBSSxFQUFFOztPQUVMOztLQUVGO0lBQ0Y7O0VBRUQsUUFBUSxDQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUM7OztFQzVINUIsTUFBTSxVQUFVLEdBQUc7SUFDakIsSUFBSSxFQUFFLGNBQWM7SUFDcEIsUUFBUSxFQUFFLE9BQU87OztJQUdqQixNQUFNLEVBQUUsSUFBSTtJQUNaLFNBQVMsRUFBRSxFQUFFOztJQUViLE1BQU0sRUFBRTtNQUNOLElBQUksRUFBRSxhQUFhO01BQ25CLFFBQVEsRUFBRSxNQUFNOztNQUVoQixJQUFJLEVBQUUsV0FBVztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsQ0FBQyxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksSUFBSSxHQUFHLE1BQUs7T0FDN0Q7O01BRUQsRUFBRSxFQUFFLFNBQVMsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7UUFDckMsSUFBSSxJQUFJLENBQUMsU0FBUztVQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDZFQUE2RSxDQUFDOzs7OztRQU9oRyxNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ3hCLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLEVBQUM7O1FBRXhCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUM7O1FBRWpELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFDO1FBQ3ZDLElBQUksQ0FBQyxJQUFJO1VBQ1AsT0FBTyxRQUFRLENBQUMscUJBQXFCLENBQUM7O1FBRXhDLE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxHQUFFOzs7UUFHckQsTUFBTSxPQUFPLEdBQUc7VUFDZCxTQUFTLEVBQUUsSUFBSTtVQUNmLE9BQU8sRUFBRSxPQUFPO1VBQ2hCLE9BQU8sRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLEVBQUU7VUFDeEQ7O1FBRUQsRUFBRSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUM7UUFDekIsRUFBRSxDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFDO1FBQ3RDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBQztPQUNsQzs7TUFFRCxpQkFBaUIsRUFBRSxTQUFTLFFBQVEsRUFBRTtRQUNwQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFDO1FBQzVCLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsYUFBYSxFQUFFLFFBQVEsQ0FBQztPQUM1RDs7TUFFRCxXQUFXLEVBQUUsU0FBUyxRQUFRLEVBQUU7UUFDOUIsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBQztRQUN4QixNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFDOzs7UUFHNUIsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFOztVQUUzQixJQUFJLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsV0FBVyxFQUFFO1lBQ3JDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDOztZQUV6QyxPQUFPLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQztTQUNwRTs7O1FBR0QsTUFBTSxJQUFJLEdBQUcsUUFBUSxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxLQUFLLEdBQUcsRUFBRSxFQUFDO1FBQ3ZFLElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUM7VUFDckIsT0FBTyxJQUFJOztRQUViLE9BQU8sS0FBSztPQUNiO0tBQ0Y7R0FDRjs7RUM3RUQ7QUFDQTs7RUFLQSxNQUFNLE9BQU8sR0FBRztJQUNkLGNBQWMsRUFBRSxVQUFVO0lBQzFCLGNBQWMsRUFBRSxVQUFVO0lBQzNCOztFQUVELFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTs7SUFFM0IsT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO0dBQ2pDOztFQUVELFNBQVMsZUFBZSxDQUFDLElBQUksRUFBRTtJQUM3QixNQUFNLGtCQUFrQixHQUFHLGFBQWEsQ0FBQyxJQUFJLEVBQUM7SUFDOUMsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBQzs7SUFFcEMsT0FBTztNQUNMLElBQUksRUFBRSxJQUFJO01BQ1YsSUFBSSxFQUFFLElBQUk7TUFDVixJQUFJLEVBQUUsa0JBQWtCO01BQ3hCLFFBQVEsRUFBRSxRQUFRO0tBQ25CO0dBQ0Y7O0VBRUQsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFOztJQUUzQixJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVE7TUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsQ0FBQzs7SUFFbEQsSUFBSSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBQzs7O0lBR2pFLElBQUksQ0FBQyxZQUFZO01BQ2YsT0FBTyxDQUFDLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxNQUFNLEdBQUcsTUFBTTs7SUFFdkQsT0FBTyxZQUFZLENBQUMsQ0FBQyxDQUFDO0dBQ3ZCOztFQUVELFNBQVMsa0JBQWtCLENBQUMsTUFBTSxFQUFFO0lBQ2xDLEtBQUssTUFBTSxRQUFRLElBQUksTUFBTSxDQUFDLFNBQVMsRUFBRTtNQUN2QyxRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBQztLQUN4Qjs7SUFFRCxNQUFNLENBQUMsU0FBUyxHQUFHLEdBQUU7R0FDdEI7O0VBRUQsTUFBTSxPQUFPLEdBQUcsU0FBUyxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTtJQUM3QyxJQUFJO01BQ0YsTUFBTSxRQUFRLEdBQUcsZUFBZSxDQUFDLElBQUksRUFBQztNQUN0QyxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsS0FBSTtNQUM5QixNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsU0FBUTs7O01BS2xDLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUNuQixJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNO1VBQzFCLE9BQU8sUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUM7O1VBRXpDLE9BQU8sT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDOztNQUVyRCxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUc7UUFDbEIsUUFBUSxFQUFFLFFBQVE7UUFDbEIsUUFBUSxFQUFFLFFBQVE7UUFDbEIsTUFBTSxFQUFFLEtBQUs7UUFDYixTQUFTLEVBQUUsQ0FBQyxRQUFRLENBQUM7UUFDdEI7Ozs7O01BS0QsTUFBTSxNQUFNLEdBQUcsVUFBVSxHQUFHLFNBQVE7TUFDcEMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEdBQUU7TUFDN0IsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxTQUFTLEdBQUcsRUFBRSxVQUFVLENBQUM7UUFDakUsSUFBSSxHQUFHO1VBQ0wsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBQzthQUNoQzs7VUFHSCxJQUFJLENBQUMsVUFBVSxJQUFJLE9BQU8sVUFBVSxLQUFLLFFBQVE7WUFDL0MsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQzs7VUFFM0YsSUFBSSxPQUFPLFVBQVUsQ0FBQyxJQUFJLEtBQUssUUFBUTtZQUNyQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDOztVQUVyRSxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsUUFBUSxFQUFDO1VBQ2hDLElBQUksQ0FBQyxNQUFNO1lBQ1QsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQzs7O1VBRy9DLElBQUksTUFBTSxDQUFDLE1BQU07WUFDZixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxVQUFVLENBQUMsSUFBSSxHQUFHLG1CQUFtQixDQUFDOztVQUV4RSxNQUFNLENBQUMsTUFBTSxHQUFHLFdBQVU7VUFDMUIsTUFBTSxDQUFDLE1BQU0sR0FBRyxLQUFJOztVQUVwQixrQkFBa0IsQ0FBQyxNQUFNLEVBQUM7U0FDM0I7T0FDRixFQUFDOzs7O0tBSUgsQ0FBQyxPQUFPLEdBQUcsRUFBRTtNQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLEdBQUcsSUFBSSxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUM7S0FDckU7R0FDRjs7O0VDakdELE1BQU0sVUFBVSxHQUFHLEdBQUU7RUFDckIsU0FBUyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRTtJQUN6QixJQUFJLEVBQUUsSUFBSSxZQUFZLEtBQUssQ0FBQztNQUMxQixPQUFPLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUM7O0lBRTlCLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUTtNQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLG1CQUFtQixHQUFHLElBQUksR0FBRyxvQkFBb0IsQ0FBQzs7O0lBR3BFLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQztNQUNsQixPQUFPLFVBQVUsQ0FBQyxJQUFJLENBQUM7O0lBRXpCLElBQUksU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLElBQUksRUFBQztJQUNuQyxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxTQUFTLGFBQWEsRUFBRTtNQUMxQyxJQUFJOztRQUlGLElBQUksT0FBTyxhQUFhLEtBQUssUUFBUTtVQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxDQUFDOzs7UUFHbkVBLFlBQW9CLENBQUMsU0FBUyxFQUFFLGFBQWEsRUFBQzs7O1FBRzlDQyxhQUFxQixDQUFDLFNBQVMsRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBQztRQUMzRCxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxhQUFhLENBQUMsS0FBSTs7O1FBR3pDLFNBQVMsR0FBRyxlQUFlLENBQUMsU0FBUyxFQUFDOzs7UUFHdEMsU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLEdBQUdDLGlCQUF5QixDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsYUFBYSxDQUFDLFFBQVEsRUFBQzs7UUFFaEcsU0FBUyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSTtRQUM3QixRQUFRLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUM7OztRQUduQyxJQUFJLFNBQVMsQ0FBQyxTQUFTO1VBQ3JCLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsVUFBUzs7T0FFekMsQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxHQUFHLElBQUksR0FBRyxvQkFBb0IsR0FBRyxHQUFHLENBQUM7T0FDcEU7S0FDRixFQUFDOztJQUVGLE9BQU8sU0FBUztHQUNqQjs7RUFFRCxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUU7SUFDdkIsTUFBTSxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQyxJQUFJLEVBQUM7SUFDaERELGFBQXFCLENBQUMsU0FBUyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUM7OztJQUduREQsWUFBb0IsQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUM7OztJQUdqRCxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBQztJQUNsREEsWUFBb0IsQ0FBQyxhQUFhLEVBQUUsYUFBYSxFQUFDO0lBQ2xELE1BQU0sQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsRUFBQztJQUMxSCxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxLQUFJOztJQUUzQixPQUFPLFNBQVM7R0FDakI7O0VBRUQsU0FBUyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUU7O0lBRWxDLE9BQU8sV0FBVzs7TUFFaEIsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDO1FBQ2xCLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQzs7TUFFekIsTUFBTSxTQUFTLEdBQUcsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFDO01BQ2pDLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLFVBQVM7O01BRWpDLE9BQU8sU0FBUztLQUNqQjtHQUNGOzs7QUFHREMsZUFBcUIsQ0FBQyxLQUFLLEVBQUUsYUFBYSxFQUFDO0FBQzNDQSxlQUFxQixDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsT0FBTyxFQUFDOzs7RUFHakQsUUFBUSxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUM7Ozs7In0=
