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
        if (typeof window !== 'undefined')
          url = '../node_modules/' + url;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmRlYnVnID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nLmRlYnVnKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZy5kZWJ1ZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG5cbiAgICAgIC8vIC5mcm9tKEV2ZW50cykgc3RhcnQgdGhlIGZsb3cgYXQgaW5kZXggMFxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgMClcbiAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcblxuICAgIH0gZWxzZSBpZiAocGlwZS5kaXJlY3Rpb24gPT09ICd0bycpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50LmluICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgaW5wdXQuJylcblxuICAgICAgcGlwZS5jb250ZXh0ID0gY3JlYXRlQ29udGV4dCh0aGlzLCBwaXBlLnRhcmdldCwgaSlcbiAgICAgIHRoaXMuRnJhbWUuZmxvdy5wdXNoKHBpcGUpXG4gICAgICBpKytcbiAgICB9XG4gIH1cblxuICBzdGFydEZsb3cuY2FsbCh0aGlzKVxufVxuXG5mdW5jdGlvbiBjcmVhdGVDb250ZXh0KHdvcmtlciwgYmx1ZXByaW50LCBpbmRleCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGJsdWVwcmludC5uYW1lLFxuICAgIHN0YXRlOiBibHVlcHJpbnQuRnJhbWUuc3RhdGUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZy5kZWJ1ZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgZG9uZSkge1xuICAgICAgICBkb25lKClcbiAgICAgIH1cblxuICAgIHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluaXQsIHByb3BzKVxuICAgIGJsdWVwcmludC5pbml0LmNhbGwoYmx1ZXByaW50LCBwcm9wcywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyKVxuICAgICAgICByZXR1cm4gbG9nLmVycm9yKCdFcnJvciBpbml0aWFsaXppbmcgYmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCdcXG4nICsgZXJyKVxuXG4gICAgICAvLyBCbHVlcHJpbnQgaW50aXRpYWx6ZWRcbiAgICAgIGxvZy5kZWJ1ZygnQmx1ZXByaW50ICcgKyBibHVlcHJpbnQubmFtZSArICcgaW50aWFsaXplZCcpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHt9XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaW5pdGlhbGl6ZWQgPSB0cnVlXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjYWxsYmFjayAmJiBjYWxsYmFjay5jYWxsKGJsdWVwcmludCkgfSwgMSlcbiAgICB9KVxuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBibHVlcHJpbnQubmFtZSArICdcXCcgY291bGQgbm90IGluaXRpYWxpemUuXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgeyBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCB7IGRlc3RydWN0dXJlLCBhc3NpZ25PYmplY3QsIHNldERlc2NyaXB0b3IgfSBmcm9tICcuL2hlbHBlcnMnXG5pbXBvcnQgeyBwcm9jZXNzRmxvdyB9IGZyb20gJy4vZmxvdydcblxuLy8gQmx1ZXByaW50IE1ldGhvZHNcbmNvbnN0IEJsdWVwcmludE1ldGhvZHMgPSB7XG4gIHRvOiBmdW5jdGlvbih0YXJnZXQpIHtcbiAgICByZXR1cm4gYWRkUGlwZS5jYWxsKHRoaXMsICd0bycsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIGZyb206IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ2Zyb20nLCB0YXJnZXQsIEFycmF5LmZyb20oYXJndW1lbnRzKS5zbGljZSgxKSlcbiAgfSxcblxuICBvdXQ6IGZ1bmN0aW9uKGluZGV4LCBkYXRhKSB7XG4gICAgbG9nLmRlYnVnKCdXb3JrZXIgJyArIHRoaXMubmFtZSArICcub3V0OicsIGRhdGEsIGFyZ3VtZW50cylcbiAgICBxdWV1ZShuZXh0UGlwZSwgdGhpcywgW2luZGV4LCBudWxsLCBkYXRhXSlcbiAgfSxcblxuICBlcnJvcjogZnVuY3Rpb24oaW5kZXgsIGVycikge1xuICAgIGxvZy5lcnJvcignV29ya2VyICcgKyB0aGlzLm5hbWUgKyAnLmVycm9yOicsIGVyciwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgZ2V0IHZhbHVlKCkge1xuICAgIC8vIEJhaWwgaWYgd2UncmUgbm90IHJlYWR5LiAoVXNlZCB0byBnZXQgb3V0IG9mIE9iamVjdE1vZGVsIGFuZCBhc3NpZ25PYmplY3QgbGltYm8pXG4gICAgaWYgKCF0aGlzLkZyYW1lKVxuICAgICAgcmV0dXJuICcnXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG4gICAgY29uc3QgcHJvbWlzZUZvclZhbHVlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9taXNlID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCB9XG4gICAgfSlcbiAgICByZXR1cm4gcHJvbWlzZUZvclZhbHVlXG4gIH0sXG59XG5cbi8vIEZsb3cgTWV0aG9kIGhlbHBlcnNcbmZ1bmN0aW9uIEJsdWVwcmludFN0dWIodGFyZ2V0KSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IHt9XG4gIGFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgYmx1ZXByaW50LnN0dWIgPSB0cnVlXG4gIGJsdWVwcmludC5GcmFtZSA9IHtcbiAgICBwYXJlbnRzOiBbXSxcbiAgICBkZXNjcmliZTogW10sXG4gIH1cblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnRnVuY3Rpb24nKVxuICAgIGJsdWVwcmludC5pbiA9IHRhcmdldFxuICAgIGJsdWVwcmludC5vbiA9IHRhcmdldFxuICB9IGVsc2Uge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnUHJpbWl0aXZlJylcbiAgICBibHVlcHJpbnQuaW4gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcuaW46JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgICBibHVlcHJpbnQub24gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcub246JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5xdWV1ZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucXVldWUgPSBbXVxuXG4gIC8vIFF1ZXVlIGFycmF5IGlzIHByaW1hcmlseSBmb3IgSURFLlxuICBsZXQgcXVldWVQb3NpdGlvbiA9IGJsdWVwcmludC5GcmFtZS5xdWV1ZS5sZW5ndGhcbiAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlLnB1c2goc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBDbGVhbnVwIHF1ZXVlXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIDEpKVxufVxuXG5mdW5jdGlvbiBmYWN0b3J5KGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICB9XG59XG5cbi8vIFBpcGUgY29udHJvbFxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgaW5zdGFuY2UsIGRpZCB5b3UgYXNzaWduIHRoZSBtZXRob2QgdG8gYSB2YXJpYWJsZT8nKVxuXG4gIGlmICghdGhpcy5GcmFtZSB8fCAhdGhpcy5GcmFtZS5waXBlcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCB3b3JraW5nIHdpdGggYSB2YWxpZCBCbHVlcHJpbnQgb2JqZWN0JylcblxuICBpZiAoIXRhcmdldClcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdGFyZ2V0LnRvICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9XG5cbiAgLy8gRW5zdXJlIHdlJ3JlIHdvcmtpbmcgb24gYSBuZXcgaW5zdGFuY2Ugb2Ygd29ya2VyIGJsdWVwcmludFxuICBsZXQgYmx1ZXByaW50ID0gdGhpc1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSkge1xuICAgIGJsdWVwcmludCA9IGJsdWVwcmludCgpXG4gICAgLy8gVE9ETzogQ2hlY2sgaWYgd2Ugd2lsbCBoYXZlIGEgcmFjZSBjb25kaXRpb24gd2l0aCBmbG93LmpzOiBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSB7fVxuICAgIGJsdWVwcmludC5GcmFtZS5wcm9wcyA9IHRoaXMuRnJhbWUucHJvcHNcbiAgICBibHVlcHJpbnQuRnJhbWUuc3RhdGUgPSB0aGlzLkZyYW1lLnN0YXRlXG4gICAgYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlID0gdHJ1ZVxuICB9XG5cbiAgbG9nLmRlYnVnKGJsdWVwcmludC5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpOiAnICsgdGFyZ2V0Lm5hbWUpXG4gIGJsdWVwcmludC5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuXG4gIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gIGlmICh0YXJnZXQgJiYgdGFyZ2V0LkZyYW1lKVxuICAgIHRhcmdldC5GcmFtZS5wYXJlbnRzLnB1c2goeyB0YXJnZXQ6IGJsdWVwcmludCB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGxvZy5kZWJ1ZygnbmV4dDonLCBpbmRleClcbiAgaWYgKGVycikge1xuICAgIGxvZy5lcnJvcignVE9ETzogaGFuZGxlIGVycm9yOicsIGVycilcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGZsb3cgPSB0aGlzLkZyYW1lLmZsb3dcbiAgY29uc3QgbmV4dCA9IGZsb3dbaW5kZXhdXG5cbiAgLy8gSWYgd2UncmUgYXQgdGhlIGVuZCBvZiB0aGUgZmxvd1xuICBpZiAoIW5leHQgfHwgIW5leHQudGFyZ2V0KSB7XG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG5cbiAgICBpZiAodGhpcy5GcmFtZS5pc1Byb21pc2VkKSB7XG4gICAgICB0aGlzLkZyYW1lLnByb21pc2UucmVzb2x2ZShkYXRhKVxuICAgICAgdGhpcy5GcmFtZS5pc1Byb21pc2VkID0gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBJZiBibHVlcHJpbnQgaXMgcGFydCBvZiBhbm90aGVyIGZsb3dcbiAgICBjb25zdCBwYXJlbnRzID0gdGhpcy5GcmFtZS5wYXJlbnRzXG4gICAgaWYgKHBhcmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgICBsZXQgYmx1ZXByaW50ID0gcGFyZW50LnRhcmdldFxuICAgICAgICBsb2cuZGVidWcoJ0NhbGxpbmcgcGFyZW50ICcgKyBibHVlcHJpbnQubmFtZSwgJ2ZvcicsIHRoaXMubmFtZSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2cuZGVidWcoJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGNvbnRleHQsIGRhdGEsIHByb3BzLCBuZXcgZmFjdG9yeShwaXBlQ2FsbGJhY2spLmJpbmQoY29udGV4dCkpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnRleHQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGNvbnRleHQub3V0KHJldFZhbHVlKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBpcGVDYWxsYmFjayhlcnIsIGRhdGEpIHtcbiAgaWYgKGVycilcbiAgICByZXR1cm4gdGhpcy5lcnJvcihlcnIpXG5cbiAgcmV0dXJuIHRoaXMub3V0KGRhdGEpXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuLy8gSW50ZXJuYWwgRnJhbWUgcHJvcHNcbmNvbnN0IEJsdWVwcmludEJhc2UgPSB7XG4gIG5hbWU6ICcnLFxuICBkZXNjcmliZTogWydpbml0JywgJ2luJywgJ291dCddLFxuICBwcm9wczoge30sXG4gIHN0YXRlOiB7fSxcblxuICBsb2FkZWQ6IGZhbHNlLFxuICBpbml0aWFsaXplZDogZmFsc2UsXG4gIHByb2Nlc3NpbmdGbG93OiBmYWxzZSxcbiAgZGVib3VuY2U6IHt9LFxuICBwYXJlbnRzOiBbXSxcblxuICBpbnN0YW5jZTogZmFsc2UsXG4gIHBpcGVzOiBbXSxcbiAgZXZlbnRzOiBbXSxcbiAgZmxvdzogW10sXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludEJhc2VcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBDb25jZXB0IGJhc2VkIG9uOiBodHRwOi8vb2JqZWN0bW9kZWwuanMub3JnL1xuZnVuY3Rpb24gT2JqZWN0TW9kZWwoc2NoZW1hT2JqKSB7XG4gIGlmICh0eXBlb2Ygc2NoZW1hT2JqID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogc2NoZW1hT2JqLm5hbWUsIGV4cGVjdHM6IHNjaGVtYU9iaiB9XG4gIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYU9iaiAhPT0gJ29iamVjdCcpXG4gICAgc2NoZW1hT2JqID0ge31cblxuICAvLyBDbG9uZSBzY2hlbWEgb2JqZWN0IHNvIHdlIGRvbid0IG11dGF0ZSBpdC5cbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LmNyZWF0ZShzY2hlbWFPYmopXG4gIE9iamVjdC5hc3NpZ24oc2NoZW1hLCBzY2hlbWFPYmopXG5cbiAgLy8gTG9vcCB0aHJvdWdoIFNjaGVtYSBvYmplY3Qga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzY2hlbWEpKSB7XG4gICAgLy8gQ3JlYXRlIGEgc2NoZW1hIG9iamVjdCB3aXRoIHR5cGVzXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldKCkgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgQXJyYXkuaXNBcnJheShzY2hlbWFba2V5XSkpIHtcbiAgICAgIGNvbnN0IHNjaGVtYUFyciA9IHNjaGVtYVtrZXldXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IGZhbHNlLCB0eXBlOiAnb3B0aW9uYWwnLCB0eXBlczogW10gfVxuICAgICAgZm9yIChjb25zdCBzY2hlbWFUeXBlIG9mIHNjaGVtYUFycikge1xuICAgICAgICBpZiAodHlwZW9mIHNjaGVtYVR5cGUgPT09ICdmdW5jdGlvbicpXG4gICAgICAgICAgc2NoZW1hW2tleV0udHlwZXMucHVzaCh0eXBlb2Ygc2NoZW1hVHlwZSgpKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHNjaGVtYVtrZXldLnR5cGUsIGV4cGVjdHM6IHNjaGVtYVtrZXldLmV4cGVjdHMgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSB9XG4gICAgfVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIHByb3BzXG4gIGZ1bmN0aW9uIGlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkge1xuICAgIC8vIFRPRE86IE1ha2UgbW9yZSBmbGV4aWJsZSBieSBkZWZpbmluZyBudWxsIGFuZCB1bmRlZmluZWQgdHlwZXMuXG4gICAgLy8gTm8gc2NoZW1hIGRlZmluZWQgZm9yIGtleVxuICAgIGlmICghc2NoZW1hW2tleV0pXG4gICAgICByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHR5cGVvZiB2YWx1ZSA9PT0gc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKCFzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICBpZiAodmFsdWUgJiYgIXNjaGVtYVtrZXldLnR5cGVzLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gICAgICAgIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgaWYgKHR5cGVvZiBzY2hlbWFba2V5XS5leHBlY3RzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWFba2V5XS5leHBlY3RzKHZhbHVlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2NoZW1hIChvbmNlIFNjaGVtYSBjb25zdHJ1Y3RvciBpcyBjYWxsZWQpXG4gIHJldHVybiBmdW5jdGlvbiB2YWxpZGF0ZVNjaGVtYShvYmpUb1ZhbGlkYXRlKSB7XG4gICAgY29uc3QgcHJveHlPYmogPSB7fVxuICAgIGNvbnN0IG9iaiA9IG9ialRvVmFsaWRhdGVcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9ialRvVmFsaWRhdGUpKSB7XG4gICAgICBjb25zdCBwcm9wRGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqVG9WYWxpZGF0ZSwga2V5KVxuXG4gICAgICAvLyBQcm9wZXJ0eSBhbHJlYWR5IHByb3RlY3RlZFxuICAgICAgaWYgKCFwcm9wRGVzY3JpcHRvci53cml0YWJsZSB8fCAhcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIFNjaGVtYSBkb2VzIG5vdCBleGlzdCBmb3IgcHJvcCwgcGFzc3Rocm91Z2hcbiAgICAgIGlmICghc2NoZW1hW2tleV0pIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgIH0sXG5cbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFueSBzY2hlbWEgbGVmdG92ZXIgc2hvdWxkIGJlIGFkZGVkIGJhY2sgdG8gb2JqZWN0IGZvciBmdXR1cmUgcHJvdGVjdGlvblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc2NoZW1hKSkge1xuICAgICAgICBpZiAob2JqW2tleV0pXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICAgIGVudW1lcmFibGU6IHByb3BEZXNjcmlwdG9yLmVudW1lcmFibGUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm94eU9ialtrZXldXG4gICAgICAgICAgfSxcblxuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGlmICghaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSkge1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm94eU9ialtrZXldID0gdmFsdWVcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIG9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIG9ialxuICB9XG59XG5cbk9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rID0gT2JqZWN0TW9kZWwoZnVuY3Rpb24gU3RyaW5nTm90Qmxhbmsoc3RyKSB7XG4gIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJylcbiAgICByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gc3RyLnRyaW0oKS5sZW5ndGggPiAwXG59KVxuXG5leHBvcnQgZGVmYXVsdCBPYmplY3RNb2RlbFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBPYmplY3RNb2RlbCBmcm9tICcuL09iamVjdE1vZGVsJ1xuXG4vLyBQcm90ZWN0IEJsdWVwcmludCB1c2luZyBhIHNjaGVtYVxuY29uc3QgQmx1ZXByaW50U2NoZW1hID0gbmV3IE9iamVjdE1vZGVsKHtcbiAgbmFtZTogT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmssXG5cbiAgLy8gQmx1ZXByaW50IHByb3ZpZGVzXG4gIGluaXQ6IFtGdW5jdGlvbl0sXG4gIGluOiBbRnVuY3Rpb25dLFxuICBvbjogW0Z1bmN0aW9uXSxcbiAgZGVzY3JpYmU6IFtPYmplY3RdLFxuXG4gIC8vIEludGVybmFsc1xuICBvdXQ6IEZ1bmN0aW9uLFxuICBlcnJvcjogRnVuY3Rpb24sXG4gIGNsb3NlOiBbRnVuY3Rpb25dLFxuXG4gIC8vIFVzZXIgZmFjaW5nXG4gIHRvOiBGdW5jdGlvbixcbiAgZnJvbTogRnVuY3Rpb24sXG59KVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRTY2hlbWFcbiIsIi8vIFRPRE86IE1vZHVsZUZhY3RvcnkoKSBmb3IgbG9hZGVyLCB3aGljaCBwYXNzZXMgdGhlIGxvYWRlciArIHByb3RvY29sIGludG8gaXQuLiBUaGF0IHdheSBpdCdzIHJlY3Vyc2l2ZS4uLlxuXG5mdW5jdGlvbiBNb2R1bGUoX19maWxlbmFtZSwgZmlsZUNvbnRlbnRzLCBjYWxsYmFjaykge1xuICAvLyBGcm9tIGlpZmUgY29kZVxuICBpZiAoIWZpbGVDb250ZW50cylcbiAgICBfX2ZpbGVuYW1lID0gX19maWxlbmFtZS5wYXRoIHx8ICcnXG5cbiAgdmFyIG1vZHVsZSA9IHtcbiAgICBmaWxlbmFtZTogX19maWxlbmFtZSxcbiAgICBleHBvcnRzOiB7fSxcbiAgICBCbHVlcHJpbnQ6IG51bGwsXG4gICAgcmVzb2x2ZToge30sXG5cbiAgICByZXF1aXJlOiBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgICAgIHVybCA9ICcuLi9ub2RlX21vZHVsZXMvJyArIHVybFxuICAgICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICB3aW5kb3cuaHR0cC5tb2R1bGUuaW5pdC5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSlcbiAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICB9XG5cblxuICByZXR1cm4gc2NyaXB0XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vZHVsZVxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuaW1wb3J0IE1vZHVsZSBmcm9tICcuLi8uLi9saWIvTW9kdWxlTG9hZGVyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4uLy4uL2xpYi9leHBvcnRzJ1xuXG4vLyBFbWJlZGRlZCBodHRwIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBodHRwTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9odHRwJyxcbiAgcHJvdG9jb2w6ICdsb2FkZXInLCAvLyBlbWJlZGRlZCBsb2FkZXJcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnSFRUUCBMb2FkZXInLFxuICAgIHByb3RvY29sOiBbJ2h0dHAnLCAnaHR0cHMnLCAnd2ViOi8vJ10sIC8vIFRPRE86IENyZWF0ZSBhIHdheSBmb3IgbG9hZGVyIHRvIHN1YnNjcmliZSB0byBtdWx0aXBsZSBwcm90b2NvbHNcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICghdGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnVVJMIGxvYWRpbmcgd2l0aCBub2RlLmpzIG5vdCBzdXBwb3J0ZWQgeWV0IChDb21pbmcgc29vbiEpLicpXG5cbiAgICAgIHJldHVybiB0aGlzLmJyb3dzZXIubG9hZC5jYWxsKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBjb25zdCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgY29uc3QgZmlsZVBhdGggPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVQYXRoXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZy5kZWJ1ZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgaXNBc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgaXNBc3luYyA9IGZhbHNlXG4gICAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbihlcnIsIGZpbGUpIHtcbiAgICAgICAgICAgIGlmIChlcnIpXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnIpXG5cbiAgICAgICAgICAgIHJldHVybiBzeW5jRmlsZSA9IGZpbGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KClcblxuICAgICAgICAvLyBUT0RPOiBOZWVkcyB2YWxpZGF0aW5nIHRoYXQgZXZlbnQgaGFuZGxlcnMgd29yayBhY3Jvc3MgYnJvd3NlcnMuIE1vcmUgc3BlY2lmaWNhbGx5LCB0aGF0IHRoZXkgcnVuIG9uIEVTNSBlbnZpcm9ubWVudHMuXG4gICAgICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9YTUxIdHRwUmVxdWVzdCNCcm93c2VyX2NvbXBhdGliaWxpdHlcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gbmV3IHRoaXMuYnJvd3Nlci5zY3JpcHRFdmVudHModGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG5cbiAgICAgICAgc2NyaXB0UmVxdWVzdC5vcGVuKCdHRVQnLCBmaWxlUGF0aCwgaXNBc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZy5kZWJ1ZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIC8vIFRPRE86IENyZWF0ZSBhIG1vcmUgY29tcGxldGUgc2FuZGJveCBvYmplY3RcbiAgICAgIGNvbnN0IHNhbmRib3ggPSB7XG4gICAgICAgIEJsdWVwcmludDogbnVsbCxcbiAgICAgICAgcmVxdWlyZTogcmVxdWlyZSxcbiAgICAgICAgY29uc29sZTogeyBsb2c6IGxvZywgZXJyb3I6IGxvZy5lcnJvciwgd2FybjogbG9nLndhcm4gfVxuICAgICAgfVxuXG4gICAgICB2bS5jcmVhdGVDb250ZXh0KHNhbmRib3gpXG4gICAgICB2bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuICAgICAgY2FsbGJhY2sobnVsbCwgc2FuZGJveC5CbHVlcHJpbnQpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYmx1ZXByaW50cy8nLCBmaWxlTmFtZSlcbiAgICB9LFxuXG4gICAgcmVzb2x2ZUZpbGU6IGZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcblxuICAgICAgLy8gSWYgZmlsZSBvciBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmx1ZXByaW50IGlzIGEgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGlmIChmcy5zdGF0U3luYyhmaWxlUGF0aCkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKGZpbGVQYXRoLCAnaW5kZXguanMnKVxuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIH1cblxuICAgICAgLy8gVHJ5IGFkZGluZyBhbiBleHRlbnNpb24gdG8gc2VlIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUpKVxuICAgICAgICByZXR1cm4gZmlsZVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICB9LFxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGZpbGVMb2FkZXJcbiIsIi8qIGVzbGludC1kaXNhYmxlIHByZWZlci10ZW1wbGF0ZSAqL1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBodHRwTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwJ1xuaW1wb3J0IGZpbGVMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUnXG5cbi8vIE11bHRpLWVudmlyb25tZW50IGFzeW5jIG1vZHVsZSBsb2FkZXJcbmNvbnN0IG1vZHVsZXMgPSB7XG4gICdsb2FkZXJzL2h0dHAnOiBodHRwTG9hZGVyLFxuICAnbG9hZGVycy9maWxlJzogZmlsZUxvYWRlcixcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gIC8vIFRPRE86IGxvb3AgdGhyb3VnaCBlYWNoIGZpbGUgcGF0aCBhbmQgbm9ybWFsaXplIGl0IHRvbzpcbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkvLy5jYXBpdGFsaXplKClcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUZpbGVJbmZvKGZpbGUpIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVOYW1lID0gbm9ybWFsaXplTmFtZShmaWxlKVxuICBjb25zdCBwcm90b2NvbCA9IHBhcnNlUHJvdG9jb2woZmlsZSlcblxuICByZXR1cm4ge1xuICAgIGZpbGU6IGZpbGUsXG4gICAgcGF0aDogZmlsZSxcbiAgICBuYW1lOiBub3JtYWxpemVkRmlsZU5hbWUsXG4gICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvdG9jb2wobmFtZSkge1xuICAvLyBGSVhNRTogbmFtZSBzaG91bGQgb2YgYmVlbiBub3JtYWxpemVkIGJ5IG5vdy4gRWl0aGVyIHJlbW92ZSB0aGlzIGNvZGUgb3IgbW92ZSBpdCBzb21ld2hlcmUgZWxzZS4uXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxvYWRlciBibHVlcHJpbnQgbmFtZScpXG5cbiAgdmFyIHByb3RvUmVzdWx0cyA9IG5hbWUubWF0Y2goLzpcXC9cXC8vZ2kpICYmIG5hbWUuc3BsaXQoLzpcXC9cXC8vZ2kpXG5cbiAgLy8gTm8gcHJvdG9jb2wgZm91bmQsIGlmIGJyb3dzZXIgZW52aXJvbm1lbnQgdGhlbiBpcyByZWxhdGl2ZSBVUkwgZWxzZSBpcyBhIGZpbGUgcGF0aC4gKFNhbmUgZGVmYXVsdHMgYnV0IGNhbiBiZSBvdmVycmlkZGVuKVxuICBpZiAoIXByb3RvUmVzdWx0cylcbiAgICByZXR1cm4gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/ICdodHRwJyA6ICdmaWxlJ1xuXG4gIHJldHVybiBwcm90b1Jlc3VsdHNbMF1cbn1cblxuZnVuY3Rpb24gcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSkge1xuICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIG1vZHVsZS5jYWxsYmFja3MpIHtcbiAgICBjYWxsYmFjayhtb2R1bGUubW9kdWxlKVxuICB9XG5cbiAgbW9kdWxlLmNhbGxiYWNrcyA9IFtdXG59XG5cbmNvbnN0IGltcG9ydHMgPSBmdW5jdGlvbihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IGZpbGVJbmZvID0gcmVzb2x2ZUZpbGVJbmZvKG5hbWUpXG4gICAgY29uc3QgZmlsZU5hbWUgPSBmaWxlSW5mby5uYW1lXG4gICAgY29uc3QgcHJvdG9jb2wgPSBmaWxlSW5mby5wcm90b2NvbFxuXG4gICAgbG9nLmRlYnVnKCdsb2FkaW5nIG1vZHVsZTonLCBmaWxlTmFtZSlcblxuICAgIC8vIE1vZHVsZSBoYXMgbG9hZGVkIG9yIHN0YXJ0ZWQgdG8gbG9hZFxuICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXSlcbiAgICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXS5sb2FkZWQpXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhtb2R1bGVzW2ZpbGVOYW1lXS5tb2R1bGUpIC8vIFJldHVybiBtb2R1bGUgZnJvbSBDYWNoZVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbW9kdWxlc1tmaWxlTmFtZV0uY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC8vIE5vdCBsb2FkZWQgeWV0LCByZWdpc3RlciBjYWxsYmFja1xuXG4gICAgbW9kdWxlc1tmaWxlTmFtZV0gPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXG4gICAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgY2FsbGJhY2tzOiBbY2FsbGJhY2tdLFxuICAgIH1cblxuICAgIC8vIEJvb3RzdHJhcHBpbmcgbG9hZGVyIGJsdWVwcmludHMgOylcbiAgICAvL0ZyYW1lKCdMb2FkZXJzLycgKyBwcm90b2NvbCkuZnJvbShmaWxlTmFtZSkudG8oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSkge30pXG5cbiAgICBjb25zdCBsb2FkZXIgPSAnbG9hZGVycy8nICsgcHJvdG9jb2xcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluaXQoKSAvLyBUT0RPOiBvcHRpb25hbCBpbml0IChpbnNpZGUgRnJhbWUgY29yZSlcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpe1xuICAgICAgaWYgKGVycilcbiAgICAgICAgbG9nLmVycm9yKCdFcnJvcjogJywgZXJyLCBmaWxlTmFtZSlcbiAgICAgIGVsc2Uge1xuICAgICAgICBsb2cuZGVidWcoJ0xvYWRlZCBCbHVlcHJpbnQgbW9kdWxlOiAnLCBmaWxlTmFtZSlcblxuICAgICAgICBpZiAoIWV4cG9ydEZpbGUgfHwgdHlwZW9mIGV4cG9ydEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRGaWxlLm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IG1pc3NpbmcgYSBuYW1lJylcblxuICAgICAgICBjb25zdCBtb2R1bGUgPSBtb2R1bGVzW2ZpbGVOYW1lXVxuICAgICAgICBpZiAoIW1vZHVsZSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VoIG9oLCB3ZSBzaG91bGRudCBiZSBoZXJlJylcblxuICAgICAgICAvLyBNb2R1bGUgYWxyZWFkeSBsb2FkZWQuIE5vdCBzdXBwb3NlIHRvIGJlIGhlcmUuIE9ubHkgZnJvbSBmb3JjZS1sb2FkaW5nIHdvdWxkIGdldCB5b3UgaGVyZS5cbiAgICAgICAgaWYgKG1vZHVsZS5sb2FkZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXCInICsgZXhwb3J0RmlsZS5uYW1lICsgJ1wiIGFscmVhZHkgbG9hZGVkLicpXG5cbiAgICAgICAgbW9kdWxlLm1vZHVsZSA9IGV4cG9ydEZpbGVcbiAgICAgICAgbW9kdWxlLmxvYWRlZCA9IHRydWVcblxuICAgICAgICBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBUT0RPOiBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmJ1bmRsZSBzdXBwb3J0IGZvciBDTEkgdG9vbGluZy5cblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBsb2FkIGJsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCdcXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGltcG9ydHNcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4vZXhwb3J0cydcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IEJsdWVwcmludE1ldGhvZHMgZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IHsgZGVib3VuY2UsIHByb2Nlc3NGbG93IH0gZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IEJsdWVwcmludEJhc2UgZnJvbSAnLi9CbHVlcHJpbnRCYXNlJ1xuaW1wb3J0IEJsdWVwcmludFNjaGVtYSBmcm9tICcuL3NjaGVtYSdcbmltcG9ydCBpbXBvcnRzIGZyb20gJy4vbG9hZGVyJ1xuXG4vLyBGcmFtZSBhbmQgQmx1ZXByaW50IGNvbnN0cnVjdG9yc1xuY29uc3Qgc2luZ2xldG9ucyA9IHt9XG5mdW5jdGlvbiBGcmFtZShuYW1lLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBGcmFtZSkpXG4gICAgcmV0dXJuIG5ldyBGcmFtZShuYW1lLCBvcHRzKVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbmFtZSBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicpXG5cbiAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICBsZXQgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludChuYW1lKVxuICBpbXBvcnRzKG5hbWUsIG9wdHMsIGZ1bmN0aW9uKGJsdWVwcmludEZpbGUpIHtcbiAgICB0cnkge1xuXG4gICAgICBsb2cuZGVidWcoJ0JsdWVwcmludCBsb2FkZWQ6JywgYmx1ZXByaW50RmlsZS5uYW1lKVxuXG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAvLyBVcGRhdGUgZmF1eCBibHVlcHJpbnQgc3R1YiB3aXRoIHJlYWwgbW9kdWxlXG4gICAgICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIGJsdWVwcmludEZpbGUpXG5cbiAgICAgIC8vIFVwZGF0ZSBibHVlcHJpbnQgbmFtZVxuICAgICAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgYmx1ZXByaW50RmlsZS5uYW1lLCBmYWxzZSlcbiAgICAgIGJsdWVwcmludC5GcmFtZS5uYW1lID0gYmx1ZXByaW50RmlsZS5uYW1lXG5cbiAgICAgIC8vIEFwcGx5IGEgc2NoZW1hIHRvIGJsdWVwcmludFxuICAgICAgYmx1ZXByaW50ID0gQmx1ZXByaW50U2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVmFsaWRhdGUgQmx1ZXByaW50IGlucHV0IHdpdGggb3B0aW9uYWwgcHJvcGVydHkgZGVzdHJ1Y3R1cmluZyAodXNpbmcgZGVzY3JpYmUgb2JqZWN0KVxuICAgICAgYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlID0gaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZShibHVlcHJpbnQuZGVzY3JpYmUsIEJsdWVwcmludEJhc2UuZGVzY3JpYmUpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5sb2FkZWQgPSB0cnVlXG4gICAgICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuXG4gICAgICAvLyBJZiBibHVlcHJpbnQgaW50ZW5kcyB0byBiZSBhIHNpbmdsZXRvbiwgYWRkIGl0IHRvIHRoZSBsaXN0LlxuICAgICAgaWYgKGJsdWVwcmludC5zaW5nbGV0b24pXG4gICAgICAgIHNpbmdsZXRvbnNbYmx1ZXByaW50Lm5hbWVdID0gYmx1ZXByaW50XG5cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJyArIGVycilcbiAgICB9XG4gIH0pXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnQobmFtZSkge1xuICBjb25zdCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgY29uc3QgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSBuZXcgRnJhbWUobmFtZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSBhcmd1bWVudHNcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciIsImhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUiXSwibWFwcGluZ3MiOiI7OztFQUVBLFNBQVMsR0FBRyxHQUFHO0VBQ2Y7RUFDQSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDcEMsQ0FBQzs7RUFFRCxHQUFHLENBQUMsS0FBSyxHQUFHLFdBQVc7RUFDdkI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDdEMsRUFBQzs7RUFFRCxHQUFHLENBQUMsSUFBSSxHQUFHLFdBQVc7RUFDdEI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDckMsRUFBQzs7RUFFRCxHQUFHLENBQUMsS0FBSyxHQUFHLFdBQVc7RUFDdkIsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VDbkJEO0VBQ0E7RUFDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO0VBQzdCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLEtBQUssUUFBUTtFQUN0RSxJQUFJLE1BQU0sQ0FBQyxPQUFPLEdBQUcsSUFBRzs7RUFFeEI7RUFDQSxFQUFFLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtFQUNoQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHOztFQUV0QjtF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QUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssVUFBVTtFQUN6QyxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEdBQUU7RUFDbEUsU0FBUyxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFO0VBQzVFLE1BQU0sTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLEdBQUcsRUFBQztFQUNuQyxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBRSxHQUFFO0VBQ3BFLE1BQU0sS0FBSyxNQUFNLFVBQVUsSUFBSSxTQUFTLEVBQUU7RUFDMUMsUUFBUSxJQUFJLE9BQU8sVUFBVSxLQUFLLFVBQVU7RUFDNUMsVUFBVSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLFVBQVUsRUFBRSxFQUFDO0VBQ3JELE9BQU87RUFDUCxLQUFLLE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRTtFQUNwRSxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEdBQUU7RUFDNUYsS0FBSyxNQUFNO0VBQ1gsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLE1B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
