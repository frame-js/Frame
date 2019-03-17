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

    log('Processing flow for ' + this.name);
    log();
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
    log('Starting flow for ' + this.name);

    for (const event of this.Frame.events) {
      const blueprint = event.target;
      const props = destructure(blueprint.Frame.describe.on, event.params);

      // If not already processing flow.
      if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
        log(this.name + ' is not starting ' + blueprint.name + ', waiting for it to finish');
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

  // Blueprint Methods
  const BlueprintMethods = {
    to: function(target) {
      return addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
    },

    from: function(target) {
      return addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
    },

    out: function(index, data) {
      log(this.name + '.out:', data, arguments);
      queue(nextPipe, this, [index, null, data]);
    },

    error: function(index, err) {
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
        log(this.name + '.in:', target);
        this.out(target);
      };
      blueprint.on = function primitiveWrapper() {
        log(this.name + '.on:', target);
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

    log(blueprint.name + '.' + direction + '(): ' + target.name);
    blueprint.Frame.pipes.push({ direction: direction, target: target, params: params });

    // Used when target blueprint is part of another flow
    if (target && target.Frame)
      target.Frame.parents.push({ target: blueprint, hasCalled: false }); // TODO: Check if worker blueprint is already added.

    debounce(processFlow, 1, blueprint);
    return blueprint
  }

  function nextPipe(index, err, data) {
    console.log('next:', index);
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
          log('Calling parent ' + blueprint.name, 'for', this.name);
          log('Data:', data);
          queue(nextPipe, blueprint, [0, null, data]);
        }
      }

      return log('End of flow for', this.name, 'at', index)
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG4gICAgICBlbHNlIHtcbiAgICAgICAgLy8gLmZyb20oRXZlbnRzKSBzdGFydCB0aGUgZmxvdyBhdCBpbmRleCAwXG4gICAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIDApXG4gICAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBwaXBlLmNvbnRleHQgPSBjcmVhdGVDb250ZXh0KHRoaXMsIHBpcGUudGFyZ2V0LCBpKVxuICAgICAgdGhpcy5GcmFtZS5mbG93LnB1c2gocGlwZSlcbiAgICAgIGkrK1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0Rmxvdy5jYWxsKHRoaXMpXG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvbnRleHQod29ya2VyLCBibHVlcHJpbnQsIGluZGV4KSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogYmx1ZXByaW50Lm5hbWUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soKVxuICAgICAgfVxuXG4gICAgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW5pdCwgcHJvcHMpXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbihlcnIpIHtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIHJldHVybiBsb2coJ0Vycm9yIGluaXRpYWxpemluZyBibHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG5cbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nKCdCbHVlcHJpbnQgJyArIGJsdWVwcmludC5uYW1lICsgJyBpbnRpYWxpemVkJylcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0ge31cbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXplZCA9IHRydWVcbiAgICAgIGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCB7IHByb2Nlc3NGbG93IH1cbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IHsgZGVzdHJ1Y3R1cmUsIGFzc2lnbk9iamVjdCwgc2V0RGVzY3JpcHRvciB9IGZyb20gJy4vaGVscGVycydcbmltcG9ydCB7IHByb2Nlc3NGbG93IH0gZnJvbSAnLi9mbG93J1xuXG4vLyBCbHVlcHJpbnQgTWV0aG9kc1xuY29uc3QgQmx1ZXByaW50TWV0aG9kcyA9IHtcbiAgdG86IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgZnJvbTogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAnZnJvbScsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBsb2codGhpcy5uYW1lICsgJy5vdXQ6JywgZGF0YSwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIG51bGwsIGRhdGFdKVxuICB9LFxuXG4gIGVycm9yOiBmdW5jdGlvbihpbmRleCwgZXJyKSB7XG4gICAgcXVldWUobmV4dFBpcGUsIHRoaXMsIFtpbmRleCwgZXJyXSlcbiAgfSxcblxuICBnZXQgdmFsdWUoKSB7XG4gICAgLy8gQmFpbCBpZiB3ZSdyZSBub3QgcmVhZHkuIChVc2VkIHRvIGdldCBvdXQgb2YgT2JqZWN0TW9kZWwgYW5kIGFzc2lnbk9iamVjdCBsaW1ibylcbiAgICBpZiAoIXRoaXMuRnJhbWUpXG4gICAgICByZXR1cm4gJydcblxuICAgIGNvbnN0IGJsdWVwcmludCA9IHRoaXNcbiAgICBjb25zdCBwcm9taXNlRm9yVmFsdWUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGJsdWVwcmludC5GcmFtZS5pc1Byb21pc2VkID0gdHJ1ZVxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb21pc2UgPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0IH1cbiAgICB9KVxuICAgIHJldHVybiBwcm9taXNlRm9yVmFsdWVcbiAgfSxcbn1cblxuLy8gRmxvdyBNZXRob2QgaGVscGVyc1xuZnVuY3Rpb24gQmx1ZXByaW50U3R1Yih0YXJnZXQpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0ge31cbiAgYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICBibHVlcHJpbnQuc3R1YiA9IHRydWVcbiAgYmx1ZXByaW50LkZyYW1lID0ge1xuICAgIHBhcmVudHM6IFtdLFxuICAgIGRlc2NyaWJlOiBbXSxcbiAgfVxuXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdGdW5jdGlvbicpXG4gICAgYmx1ZXByaW50LmluID0gdGFyZ2V0XG4gICAgYmx1ZXByaW50Lm9uID0gdGFyZ2V0XG4gIH0gZWxzZSB7XG4gICAgc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdQcmltaXRpdmUnKVxuICAgIGJsdWVwcmludC5pbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2codGhpcy5uYW1lICsgJy5pbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICAgIGJsdWVwcmludC5vbiA9IGZ1bmN0aW9uIHByaW1pdGl2ZVdyYXBwZXIoKSB7XG4gICAgICBsb2codGhpcy5uYW1lICsgJy5vbjonLCB0YXJnZXQpXG4gICAgICB0aGlzLm91dCh0YXJnZXQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBibHVlcHJpbnQsIGFyZ3MpIHtcbiAgY29uc3QgbmFtZSA9IGZ1bmMubmFtZVxuICBjbGVhclRpbWVvdXQoYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdKVxuICBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV0gPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSBibHVlcHJpbnQuRnJhbWUuZGVib3VuY2VbbmFtZV1cbiAgICBmdW5jLmFwcGx5KGJsdWVwcmludCwgYXJncylcbiAgfSwgd2FpdClcbn1cblxuZnVuY3Rpb24gcXVldWUoZnVuYywgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGlmICghYmx1ZXByaW50LkZyYW1lLnF1ZXVlKVxuICAgIGJsdWVwcmludC5GcmFtZS5xdWV1ZSA9IFtdXG5cbiAgYmx1ZXByaW50LkZyYW1lLnF1ZXVlLnB1c2goc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBDbGVhbnVwIHF1ZXVlXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIDEpKVxufVxuXG5mdW5jdGlvbiBmYWN0b3J5KGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICB9XG59XG5cbi8vIFBpcGUgY29udHJvbFxuZnVuY3Rpb24gYWRkUGlwZShkaXJlY3Rpb24sIHRhcmdldCwgcGFyYW1zKSB7XG4gIGlmICghdGhpcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBtZXRob2QgY2FsbGVkIHdpdGhvdXQgaW5zdGFuY2UsIGRpZCB5b3UgYXNzaWduIHRoZSBtZXRob2QgdG8gYSB2YXJpYWJsZT8nKVxuXG4gIGlmICghdGhpcy5GcmFtZSB8fCAhdGhpcy5GcmFtZS5waXBlcylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCB3b3JraW5nIHdpdGggYSB2YWxpZCBCbHVlcHJpbnQgb2JqZWN0JylcblxuICBpZiAoIXRhcmdldClcbiAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5GcmFtZS5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpIHdhcyBjYWxsZWQgd2l0aCBpbXByb3BlciBwYXJhbWV0ZXJzJylcblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdGFyZ2V0LnRvICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGFyZ2V0ID0gQmx1ZXByaW50U3R1Yih0YXJnZXQpXG4gIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9XG5cbiAgLy8gRW5zdXJlIHdlJ3JlIHdvcmtpbmcgb24gYSBuZXcgaW5zdGFuY2Ugb2Ygd29ya2VyIGJsdWVwcmludFxuICBsZXQgYmx1ZXByaW50ID0gdGhpc1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSkge1xuICAgIGJsdWVwcmludCA9IGJsdWVwcmludCgpXG4gICAgYmx1ZXByaW50LkZyYW1lLmluc3RhbmNlID0gdHJ1ZVxuICB9XG5cbiAgbG9nKGJsdWVwcmludC5uYW1lICsgJy4nICsgZGlyZWN0aW9uICsgJygpOiAnICsgdGFyZ2V0Lm5hbWUpXG4gIGJsdWVwcmludC5GcmFtZS5waXBlcy5wdXNoKHsgZGlyZWN0aW9uOiBkaXJlY3Rpb24sIHRhcmdldDogdGFyZ2V0LCBwYXJhbXM6IHBhcmFtcyB9KVxuXG4gIC8vIFVzZWQgd2hlbiB0YXJnZXQgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gIGlmICh0YXJnZXQgJiYgdGFyZ2V0LkZyYW1lKVxuICAgIHRhcmdldC5GcmFtZS5wYXJlbnRzLnB1c2goeyB0YXJnZXQ6IGJsdWVwcmludCwgaGFzQ2FsbGVkOiBmYWxzZSB9KSAvLyBUT0RPOiBDaGVjayBpZiB3b3JrZXIgYmx1ZXByaW50IGlzIGFscmVhZHkgYWRkZWQuXG5cbiAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBuZXh0UGlwZShpbmRleCwgZXJyLCBkYXRhKSB7XG4gIGNvbnNvbGUubG9nKCduZXh0OicsIGluZGV4KVxuICBpZiAoZXJyKSB7XG4gICAgbG9nLmVycm9yKCdUT0RPOiBoYW5kbGUgZXJyb3I6JywgZXJyKVxuICAgIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSBmYWxzZVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgZmxvdyA9IHRoaXMuRnJhbWUuZmxvd1xuICBjb25zdCBuZXh0ID0gZmxvd1tpbmRleF1cblxuICAvLyBJZiB3ZSdyZSBhdCB0aGUgZW5kIG9mIHRoZSBmbG93XG4gIGlmICghbmV4dCB8fCAhbmV4dC50YXJnZXQpIHtcbiAgICB0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93ID0gZmFsc2VcblxuICAgIGlmICh0aGlzLkZyYW1lLmlzUHJvbWlzZWQpIHtcbiAgICAgIHRoaXMuRnJhbWUucHJvbWlzZS5yZXNvbHZlKGRhdGEpXG4gICAgICB0aGlzLkZyYW1lLmlzUHJvbWlzZWQgPSBmYWxzZVxuICAgIH1cblxuICAgIC8vIElmIGJsdWVwcmludCBpcyBwYXJ0IG9mIGFub3RoZXIgZmxvd1xuICAgIGNvbnN0IHBhcmVudHMgPSB0aGlzLkZyYW1lLnBhcmVudHNcbiAgICBpZiAocGFyZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IHBhcmVudCBvZiBwYXJlbnRzKSB7XG4gICAgICAgIGxldCBibHVlcHJpbnQgPSBwYXJlbnQudGFyZ2V0XG4gICAgICAgIGxvZygnQ2FsbGluZyBwYXJlbnQgJyArIGJsdWVwcmludC5uYW1lLCAnZm9yJywgdGhpcy5uYW1lKVxuICAgICAgICBsb2coJ0RhdGE6JywgZGF0YSlcbiAgICAgICAgcXVldWUobmV4dFBpcGUsIGJsdWVwcmludCwgWzAsIG51bGwsIGRhdGFdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2coJ0VuZCBvZiBmbG93IGZvcicsIHRoaXMubmFtZSwgJ2F0JywgaW5kZXgpXG4gIH1cblxuICBjYWxsTmV4dChuZXh0LCBkYXRhKVxufVxuXG5mdW5jdGlvbiBjYWxsTmV4dChuZXh0LCBkYXRhKSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IG5leHQudGFyZ2V0XG4gIGNvbnN0IHByb3BzID0gZGVzdHJ1Y3R1cmUoYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlLmluLCBuZXh0LnBhcmFtcylcbiAgY29uc3QgY29udGV4dCA9IG5leHQuY29udGV4dFxuICBjb25zdCByZXRWYWx1ZSA9IGJsdWVwcmludC5pbi5jYWxsKGNvbnRleHQsIGRhdGEsIHByb3BzLCBuZXcgZmFjdG9yeShwaXBlQ2FsbGJhY2spLmJpbmQoY29udGV4dCkpXG4gIGNvbnN0IHJldFR5cGUgPSB0eXBlb2YgcmV0VmFsdWVcblxuICAvLyBCbHVlcHJpbnQuaW4gZG9lcyBub3QgcmV0dXJuIGFueXRoaW5nXG4gIGlmIChyZXRUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICByZXR1cm5cblxuICBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgLy8gSGFuZGxlIHByb21pc2VzXG4gICAgcmV0VmFsdWUudGhlbihjb250ZXh0Lm91dCkuY2F0Y2goY29udGV4dC5lcnJvcilcbiAgfSBlbHNlIGlmIChyZXRUeXBlID09PSAnb2JqZWN0JyAmJiByZXRWYWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnRleHQuZXJyb3IocmV0VmFsdWUpXG4gIH0gZWxzZSB7XG4gICAgLy8gSGFuZGxlIHJlZ3VsYXIgcHJpbWl0aXZlcyBhbmQgb2JqZWN0c1xuICAgIGNvbnRleHQub3V0KHJldFZhbHVlKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBpcGVDYWxsYmFjayhlcnIsIGRhdGEpIHtcbiAgaWYgKGVycilcbiAgICByZXR1cm4gdGhpcy5lcnJvcihlcnIpXG5cbiAgcmV0dXJuIHRoaXMub3V0KGRhdGEpXG59XG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludE1ldGhvZHNcbmV4cG9ydCB7IEJsdWVwcmludE1ldGhvZHMsIGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9XG4iLCIndXNlIHN0cmljdCdcblxuLy8gSW50ZXJuYWwgRnJhbWUgcHJvcHNcbmNvbnN0IEJsdWVwcmludEJhc2UgPSB7XG4gIG5hbWU6ICcnLFxuICBkZXNjcmliZTogWydpbml0JywgJ2luJywgJ291dCddLFxuICBwcm9wczoge30sXG5cbiAgbG9hZGVkOiBmYWxzZSxcbiAgaW5pdGlhbGl6ZWQ6IGZhbHNlLFxuICBwcm9jZXNzaW5nRmxvdzogZmFsc2UsXG4gIGRlYm91bmNlOiB7fSxcbiAgcGFyZW50czogW10sXG5cbiAgaW5zdGFuY2U6IGZhbHNlLFxuICBwaXBlczogW10sXG4gIGV2ZW50czogW10sXG4gIGZsb3c6IFtdLFxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRCYXNlXG4iLCIndXNlIHN0cmljdCdcblxuLy8gQ29uY2VwdCBiYXNlZCBvbjogaHR0cDovL29iamVjdG1vZGVsLmpzLm9yZy9cbmZ1bmN0aW9uIE9iamVjdE1vZGVsKHNjaGVtYU9iaikge1xuICBpZiAodHlwZW9mIHNjaGVtYU9iaiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB7IHR5cGU6IHNjaGVtYU9iai5uYW1lLCBleHBlY3RzOiBzY2hlbWFPYmogfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFPYmogIT09ICdvYmplY3QnKVxuICAgIHNjaGVtYU9iaiA9IHt9XG5cbiAgLy8gQ2xvbmUgc2NoZW1hIG9iamVjdCBzbyB3ZSBkb24ndCBtdXRhdGUgaXQuXG4gIGNvbnN0IHNjaGVtYSA9IE9iamVjdC5jcmVhdGUoc2NoZW1hT2JqKVxuICBPYmplY3QuYXNzaWduKHNjaGVtYSwgc2NoZW1hT2JqKVxuXG4gIC8vIExvb3AgdGhyb3VnaCBTY2hlbWEgb2JqZWN0IGtleXNcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc2NoZW1hKSkge1xuICAgIC8vIENyZWF0ZSBhIHNjaGVtYSBvYmplY3Qgd2l0aCB0eXBlc1xuICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdmdW5jdGlvbicpXG4gICAgICBzY2hlbWFba2V5XSA9IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6IHR5cGVvZiBzY2hlbWFba2V5XSgpIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIEFycmF5LmlzQXJyYXkoc2NoZW1hW2tleV0pKSB7XG4gICAgICBjb25zdCBzY2hlbWFBcnIgPSBzY2hlbWFba2V5XVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ29wdGlvbmFsJywgdHlwZXM6IFtdIH1cbiAgICAgIGZvciAoY29uc3Qgc2NoZW1hVHlwZSBvZiBzY2hlbWFBcnIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzY2hlbWFUeXBlID09PSAnZnVuY3Rpb24nKVxuICAgICAgICAgIHNjaGVtYVtrZXldLnR5cGVzLnB1c2godHlwZW9mIHNjaGVtYVR5cGUoKSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzY2hlbWFba2V5XSA9PT0gJ29iamVjdCcgJiYgc2NoZW1hW2tleV0udHlwZSkge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiBzY2hlbWFba2V5XS50eXBlLCBleHBlY3RzOiBzY2hlbWFba2V5XS5leHBlY3RzIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0gfVxuICAgIH1cbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSBwcm9wc1xuICBmdW5jdGlvbiBpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpIHtcbiAgICAvLyBUT0RPOiBNYWtlIG1vcmUgZmxleGlibGUgYnkgZGVmaW5pbmcgbnVsbCBhbmQgdW5kZWZpbmVkIHR5cGVzLlxuICAgIC8vIE5vIHNjaGVtYSBkZWZpbmVkIGZvciBrZXlcbiAgICBpZiAoIXNjaGVtYVtrZXldKVxuICAgICAgcmV0dXJuIHRydWVcblxuICAgIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiB0eXBlb2YgdmFsdWUgPT09IHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmICghc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgaWYgKHZhbHVlICYmICFzY2hlbWFba2V5XS50eXBlcy5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKVxuICAgICAgICByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0uZXhwZWN0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gc2NoZW1hW2tleV0uZXhwZWN0cyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNjaGVtYSAob25jZSBTY2hlbWEgY29uc3RydWN0b3IgaXMgY2FsbGVkKVxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGVTY2hlbWEob2JqVG9WYWxpZGF0ZSkge1xuICAgIGNvbnN0IHByb3h5T2JqID0ge31cbiAgICBjb25zdCBvYmogPSBvYmpUb1ZhbGlkYXRlXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmpUb1ZhbGlkYXRlKSkge1xuICAgICAgY29uc3QgcHJvcERlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9ialRvVmFsaWRhdGUsIGtleSlcblxuICAgICAgLy8gUHJvcGVydHkgYWxyZWFkeSBwcm90ZWN0ZWRcbiAgICAgIGlmICghcHJvcERlc2NyaXB0b3Iud3JpdGFibGUgfHwgIXByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyBTY2hlbWEgZG9lcyBub3QgZXhpc3QgZm9yIHByb3AsIHBhc3N0aHJvdWdoXG4gICAgICBpZiAoIXNjaGVtYVtrZXldKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwgcHJvcERlc2NyaXB0b3IpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICB9LFxuXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpID8gdmFsdWUgOiB0eXBlb2YgdmFsdWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIG9uZSBvZiBcIicgKyBzY2hlbWFba2V5XS50eXBlcyArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBBbnkgc2NoZW1hIGxlZnRvdmVyIHNob3VsZCBiZSBhZGRlZCBiYWNrIHRvIG9iamVjdCBmb3IgZnV0dXJlIHByb3RlY3Rpb25cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNjaGVtYSkpIHtcbiAgICAgICAgaWYgKG9ialtrZXldKVxuICAgICAgICAgIGNvbnRpbnVlXG5cbiAgICAgICAgcHJveHlPYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgICBlbnVtZXJhYmxlOiBwcm9wRGVzY3JpcHRvci5lbnVtZXJhYmxlLFxuICAgICAgICAgIGNvbmZpZ3VyYWJsZTogcHJvcERlc2NyaXB0b3IuY29uZmlndXJhYmxlLFxuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJveHlPYmpba2V5XVxuICAgICAgICAgIH0sXG5cbiAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoIWlzVmFsaWRTY2hlbWEoa2V5LCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgaWYgKHNjaGVtYVtrZXldLmV4cGVjdHMpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hW2tleV0udHlwZSA9PT0gJ29wdGlvbmFsJykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgYSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJveHlPYmpba2V5XSA9IHZhbHVlXG4gICAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgICB9LFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBvYmpba2V5XSA9IG9ialRvVmFsaWRhdGVba2V5XVxuICAgIH1cblxuICAgIHJldHVybiBvYmpcbiAgfVxufVxuXG5PYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayA9IE9iamVjdE1vZGVsKGZ1bmN0aW9uIFN0cmluZ05vdEJsYW5rKHN0cikge1xuICBpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpXG4gICAgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIHN0ci50cmltKCkubGVuZ3RoID4gMFxufSlcblxuZXhwb3J0IGRlZmF1bHQgT2JqZWN0TW9kZWxcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgT2JqZWN0TW9kZWwgZnJvbSAnLi9PYmplY3RNb2RlbCdcblxuLy8gUHJvdGVjdCBCbHVlcHJpbnQgdXNpbmcgYSBzY2hlbWFcbmNvbnN0IEJsdWVwcmludFNjaGVtYSA9IG5ldyBPYmplY3RNb2RlbCh7XG4gIG5hbWU6IE9iamVjdE1vZGVsLlN0cmluZ05vdEJsYW5rLFxuXG4gIC8vIEJsdWVwcmludCBwcm92aWRlc1xuICBpbml0OiBbRnVuY3Rpb25dLFxuICBpbjogW0Z1bmN0aW9uXSxcbiAgb246IFtGdW5jdGlvbl0sXG4gIGRlc2NyaWJlOiBbT2JqZWN0XSxcblxuICAvLyBJbnRlcm5hbHNcbiAgb3V0OiBGdW5jdGlvbixcbiAgZXJyb3I6IEZ1bmN0aW9uLFxuICBjbG9zZTogW0Z1bmN0aW9uXSxcblxuICAvLyBVc2VyIGZhY2luZ1xuICB0bzogRnVuY3Rpb24sXG4gIGZyb206IEZ1bmN0aW9uLFxufSlcblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50U2NoZW1hXG4iLCIvLyBUT0RPOiBNb2R1bGVGYWN0b3J5KCkgZm9yIGxvYWRlciwgd2hpY2ggcGFzc2VzIHRoZSBsb2FkZXIgKyBwcm90b2NvbCBpbnRvIGl0Li4gVGhhdCB3YXkgaXQncyByZWN1cnNpdmUuLi5cblxuZnVuY3Rpb24gTW9kdWxlKF9fZmlsZW5hbWUsIGZpbGVDb250ZW50cywgY2FsbGJhY2spIHtcbiAgLy8gRnJvbSBpaWZlIGNvZGVcbiAgaWYgKCFmaWxlQ29udGVudHMpXG4gICAgX19maWxlbmFtZSA9IF9fZmlsZW5hbWUucGF0aCB8fCAnJ1xuXG4gIHZhciBtb2R1bGUgPSB7XG4gICAgZmlsZW5hbWU6IF9fZmlsZW5hbWUsXG4gICAgZXhwb3J0czoge30sXG4gICAgQmx1ZXByaW50OiBudWxsLFxuICAgIHJlc29sdmU6IHt9LFxuXG4gICAgcmVxdWlyZTogZnVuY3Rpb24odXJsLCBjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgICB9LFxuICB9XG5cbiAgaWYgKCFjYWxsYmFjaylcbiAgICByZXR1cm4gbW9kdWxlXG5cbiAgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXSA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiAgICBjYWxsYmFjayhudWxsLCBleHBvcnRzKVxuICAgIGRlbGV0ZSBtb2R1bGUucmVzb2x2ZVttb2R1bGUuZmlsZW5hbWVdXG4gIH1cblxuICBjb25zdCBzY3JpcHQgPSAnbW9kdWxlLnJlc29sdmVbXCInICsgX19maWxlbmFtZSArICdcIl0oZnVuY3Rpb24oaWlmZU1vZHVsZSl7XFxuJyArXG4gICcgIHZhciBtb2R1bGUgPSBNb2R1bGUoaWlmZU1vZHVsZSlcXG4nICtcbiAgJyAgdmFyIF9fZmlsZW5hbWUgPSBtb2R1bGUuZmlsZW5hbWVcXG4nICtcbiAgJyAgdmFyIF9fZGlybmFtZSA9IF9fZmlsZW5hbWUuc2xpY2UoMCwgX19maWxlbmFtZS5sYXN0SW5kZXhPZihcIi9cIikpXFxuJyArXG4gICcgIHZhciByZXF1aXJlID0gbW9kdWxlLnJlcXVpcmVcXG4nICtcbiAgJyAgdmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnICB2YXIgcHJvY2VzcyA9IHsgYnJvd3NlcjogdHJ1ZSB9XFxuJyArXG4gICcgIHZhciBCbHVlcHJpbnQgPSBudWxsO1xcblxcbicgK1xuXG4gICcoZnVuY3Rpb24oKSB7XFxuJyArIC8vIENyZWF0ZSBJSUZFIGZvciBtb2R1bGUvYmx1ZXByaW50XG4gICdcInVzZSBzdHJpY3RcIjtcXG4nICtcbiAgICBmaWxlQ29udGVudHMgKyAnXFxuJyArXG4gICd9KS5jYWxsKG1vZHVsZS5leHBvcnRzKTtcXG4nICsgLy8gQ3JlYXRlICd0aGlzJyBiaW5kaW5nLlxuICAnICBpZiAoQmx1ZXByaW50KSB7IHJldHVybiBCbHVlcHJpbnR9XFxuJyArXG4gICcgIHJldHVybiBtb2R1bGUuZXhwb3J0c1xcbicgK1xuICAnfShtb2R1bGUpKTsnXG5cbiAgd2luZG93Lm1vZHVsZSA9IG1vZHVsZVxuICB3aW5kb3cuZ2xvYmFsID0gd2luZG93XG4gIHdpbmRvdy5Nb2R1bGUgPSBNb2R1bGVcblxuICB3aW5kb3cucmVxdWlyZSA9IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICB3aW5kb3cuaHR0cC5tb2R1bGUuaW5pdC5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSlcbiAgICByZXR1cm4gd2luZG93Lmh0dHAubW9kdWxlLmluLmNhbGwod2luZG93Lmh0dHAubW9kdWxlLCB1cmwsIGNhbGxiYWNrKVxuICB9XG5cblxuICByZXR1cm4gc2NyaXB0XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vZHVsZVxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuaW1wb3J0IE1vZHVsZSBmcm9tICcuLi8uLi9saWIvTW9kdWxlTG9hZGVyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4uLy4uL2xpYi9leHBvcnRzJ1xuXG4vLyBFbWJlZGRlZCBodHRwIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBodHRwTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9odHRwJyxcbiAgcHJvdG9jb2w6ICdsb2FkZXInLCAvLyBlbWJlZGRlZCBsb2FkZXJcblxuICAvLyBJbnRlcm5hbHMgZm9yIGVtYmVkXG4gIGxvYWRlZDogdHJ1ZSxcbiAgY2FsbGJhY2tzOiBbXSxcblxuICBtb2R1bGU6IHtcbiAgICBuYW1lOiAnSFRUUCBMb2FkZXInLFxuICAgIHByb3RvY29sOiBbJ2h0dHAnLCAnaHR0cHMnLCAnd2ViOi8vJ10sIC8vIFRPRE86IENyZWF0ZSBhIHdheSBmb3IgbG9hZGVyIHRvIHN1YnNjcmliZSB0byBtdWx0aXBsZSBwcm90b2NvbHNcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICghdGhpcy5pc0Jyb3dzZXIpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnVVJMIGxvYWRpbmcgd2l0aCBub2RlLmpzIG5vdCBzdXBwb3J0ZWQgeWV0IChDb21pbmcgc29vbiEpLicpXG5cbiAgICAgIHJldHVybiB0aGlzLmJyb3dzZXIubG9hZC5jYWxsKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICB9LFxuXG4gICAgbm9ybWFsaXplRmlsZVBhdGg6IGZ1bmN0aW9uKGZpbGVOYW1lKSB7XG4gICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignaHR0cCcpID49IDApXG4gICAgICAgIHJldHVybiBmaWxlTmFtZVxuXG4gICAgICBjb25zdCBmaWxlID0gZmlsZU5hbWUgKyAoKGZpbGVOYW1lLmluZGV4T2YoJy5qcycpID09PSAtMSkgPyAnLmpzJyA6ICcnKVxuICAgICAgY29uc3QgZmlsZVBhdGggPSAnYmx1ZXByaW50cy8nICsgZmlsZVxuICAgICAgcmV0dXJuIGZpbGVQYXRoXG4gICAgfSxcblxuICAgIGJyb3dzZXI6IHtcbiAgICAgIGxvYWQ6IGZ1bmN0aW9uKGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG4gICAgICAgIGxvZygnW2h0dHAgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlUGF0aClcblxuICAgICAgICB2YXIgaXNBc3luYyA9IHRydWVcbiAgICAgICAgdmFyIHN5bmNGaWxlID0gbnVsbFxuICAgICAgICBpZiAoIWNhbGxiYWNrKSB7XG4gICAgICAgICAgaXNBc3luYyA9IGZhbHNlXG4gICAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbihlcnIsIGZpbGUpIHtcbiAgICAgICAgICAgIGlmIChlcnIpXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnIpXG5cbiAgICAgICAgICAgIHJldHVybiBzeW5jRmlsZSA9IGZpbGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KClcblxuICAgICAgICAvLyBUT0RPOiBOZWVkcyB2YWxpZGF0aW5nIHRoYXQgZXZlbnQgaGFuZGxlcnMgd29yayBhY3Jvc3MgYnJvd3NlcnMuIE1vcmUgc3BlY2lmaWNhbGx5LCB0aGF0IHRoZXkgcnVuIG9uIEVTNSBlbnZpcm9ubWVudHMuXG4gICAgICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9YTUxIdHRwUmVxdWVzdCNCcm93c2VyX2NvbXBhdGliaWxpdHlcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gbmV3IHRoaXMuYnJvd3Nlci5zY3JpcHRFdmVudHModGhpcywgZmlsZU5hbWUsIGNhbGxiYWNrKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBzY3JpcHRFdmVudHMub25Mb2FkKVxuICAgICAgICBzY3JpcHRSZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG5cbiAgICAgICAgc2NyaXB0UmVxdWVzdC5vcGVuKCdHRVQnLCBmaWxlUGF0aCwgaXNBc3luYylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5zZW5kKG51bGwpXG5cbiAgICAgICAgcmV0dXJuIHN5bmNGaWxlXG4gICAgICB9LFxuXG4gICAgICBzY3JpcHRFdmVudHM6IGZ1bmN0aW9uKGxvYWRlciwgZmlsZU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuICAgICAgICB0aGlzLmZpbGVOYW1lID0gZmlsZU5hbWVcbiAgICAgICAgdGhpcy5vbkxvYWQgPSBsb2FkZXIuYnJvd3Nlci5vbkxvYWQuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICAgIHRoaXMub25FcnJvciA9IGxvYWRlci5icm93c2VyLm9uRXJyb3IuY2FsbCh0aGlzLCBsb2FkZXIpXG4gICAgICB9LFxuXG4gICAgICBvbkxvYWQ6IGZ1bmN0aW9uKGxvYWRlcikge1xuICAgICAgICBjb25zdCBzY3JpcHRFdmVudHMgPSB0aGlzXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRSZXF1ZXN0ID0gdGhpc1xuXG4gICAgICAgICAgaWYgKHNjcmlwdFJlcXVlc3Quc3RhdHVzID4gNDAwKVxuICAgICAgICAgICAgcmV0dXJuIHNjcmlwdEV2ZW50cy5vbkVycm9yLmNhbGwoc2NyaXB0UmVxdWVzdCwgc2NyaXB0UmVxdWVzdC5zdGF0dXNUZXh0KVxuXG4gICAgICAgICAgY29uc3Qgc2NyaXB0Q29udGVudCA9IE1vZHVsZShzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVVJMLCBzY3JpcHRSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKVxuXG4gICAgICAgICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRcbiAgICAgICAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JylcbiAgICAgICAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBzY3JpcHRDb250ZW50XG5cbiAgICAgICAgICBodG1sLmFwcGVuZENoaWxkKHNjcmlwdFRhZylcbiAgICAgICAgICBsb2FkZXIuYnJvd3Nlci5jbGVhbnVwKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBvbkVycm9yOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHNjcmlwdEV2ZW50cy5maWxlTmFtZVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBzY3JpcHRUYWcgPSB0aGlzXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcblxuICAgICAgICAgIC8vIFRyeSB0byBmYWxsYmFjayB0byBpbmRleC5qc1xuICAgICAgICAgIC8vIEZJWE1FOiBpbnN0ZWFkIG9mIGZhbGxpbmcgYmFjaywgdGhpcyBzaG91bGQgYmUgdGhlIGRlZmF1bHQgaWYgbm8gYC5qc2AgaXMgZGV0ZWN0ZWQsIGJ1dCBVUkwgdWdsaWZpZXJzIGFuZCBzdWNoIHdpbGwgaGF2ZSBpc3N1ZXMuLiBocm1tbW0uLlxuICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEgJiYgZmlsZU5hbWUuaW5kZXhPZignaW5kZXguanMnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGxvZy53YXJuKCdbaHR0cF0gQXR0ZW1wdGluZyB0byBmYWxsYmFjayB0bzogJywgZmlsZU5hbWUgKyAnL2luZGV4LmpzJylcbiAgICAgICAgICAgIHJldHVybiBsb2FkZXIuaW4uY2FsbChsb2FkZXIsIGZpbGVOYW1lICsgJy9pbmRleC5qcycsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzY3JpcHRFdmVudHMuY2FsbGJhY2soJ0NvdWxkIG5vdCBsb2FkIEJsdWVwcmludCcpXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNsZWFudXA6IGZ1bmN0aW9uKHNjcmlwdFRhZywgc2NyaXB0RXZlbnRzKSB7XG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0VGFnLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgc2NyaXB0RXZlbnRzLm9uRXJyb3IpXG4gICAgICAgIC8vZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXS5yZW1vdmVDaGlsZChzY3JpcHRUYWcpIC8vIFRPRE86IENsZWFudXBcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIG5vZGU6IHtcbiAgICAgIC8vIFN0dWIgZm9yIG5vZGUuanMgSFRUUCBsb2FkaW5nIHN1cHBvcnQuXG4gICAgfSxcblxuICB9LFxufVxuXG5leHBvcnRlcignaHR0cCcsIGh0dHBMb2FkZXIpIC8vIFRPRE86IENsZWFudXAsIGV4cG9zZSBtb2R1bGVzIGluc3RlYWRcblxuZXhwb3J0IGRlZmF1bHQgaHR0cExvYWRlclxuIiwiaW1wb3J0IGxvZyBmcm9tICcuLi8uLi9saWIvbG9nZ2VyJ1xuXG4vLyBFbWJlZGRlZCBmaWxlIGxvYWRlciBibHVlcHJpbnQuXG5jb25zdCBmaWxlTG9hZGVyID0ge1xuICBuYW1lOiAnbG9hZGVycy9maWxlJyxcbiAgcHJvdG9jb2w6ICdlbWJlZCcsXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0ZpbGUgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogJ2ZpbGUnLFxuXG4gICAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmlzQnJvd3NlciA9ICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyB0cnVlIDogZmFsc2VcbiAgICB9LFxuXG4gICAgaW46IGZ1bmN0aW9uKGZpbGVOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgaWYgKHRoaXMuaXNCcm93c2VyKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGU6Ly8gbG9hZGluZyB3aXRoaW4gYnJvd3NlciBub3Qgc3VwcG9ydGVkIHlldC4gVHJ5IHJlbGF0aXZlIFVSTCBpbnN0ZWFkLicpXG5cbiAgICAgIGxvZygnW2ZpbGUgbG9hZGVyXSBMb2FkaW5nIGZpbGU6ICcgKyBmaWxlTmFtZSlcblxuICAgICAgLy8gVE9ETzogU3dpdGNoIHRvIGFzeW5jIGZpbGUgbG9hZGluZywgaW1wcm92ZSByZXF1aXJlKCksIHBhc3MgaW4gSUlGRSB0byBzYW5kYm94LCB1c2UgSUlGRSByZXNvbHZlciBmb3IgY2FsbGJhY2tcbiAgICAgIC8vIFRPRE86IEFkZCBlcnJvciByZXBvcnRpbmcuXG5cbiAgICAgIGNvbnN0IHZtID0gcmVxdWlyZSgndm0nKVxuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5ub3JtYWxpemVGaWxlUGF0aChmaWxlTmFtZSlcblxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMucmVzb2x2ZUZpbGUoZmlsZVBhdGgpXG4gICAgICBpZiAoIWZpbGUpXG4gICAgICAgIHJldHVybiBjYWxsYmFjaygnQmx1ZXByaW50IG5vdCBmb3VuZCcpXG5cbiAgICAgIGNvbnN0IGZpbGVDb250ZW50cyA9IGZzLnJlYWRGaWxlU3luYyhmaWxlKS50b1N0cmluZygpXG5cbiAgICAgIC8vY29uc3Qgc2FuZGJveCA9IHsgQmx1ZXByaW50OiBudWxsIH1cbiAgICAgIC8vdm0uY3JlYXRlQ29udGV4dChzYW5kYm94KVxuICAgICAgLy92bS5ydW5JbkNvbnRleHQoZmlsZUNvbnRlbnRzLCBzYW5kYm94KVxuXG4gICAgICBnbG9iYWwuQmx1ZXByaW50ID0gbnVsbFxuICAgICAgdm0ucnVuSW5UaGlzQ29udGV4dChmaWxlQ29udGVudHMpXG5cbiAgICAgIGNhbGxiYWNrKG51bGwsIGdsb2JhbC5CbHVlcHJpbnQpXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxuICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYmx1ZXByaW50cy8nLCBmaWxlTmFtZSlcbiAgICB9LFxuXG4gICAgcmVzb2x2ZUZpbGU6IGZ1bmN0aW9uKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJylcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcblxuICAgICAgLy8gSWYgZmlsZSBvciBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmx1ZXByaW50IGlzIGEgZGlyZWN0b3J5IGZpcnN0XG4gICAgICAgIGlmIChmcy5zdGF0U3luYyhmaWxlUGF0aCkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgICByZXR1cm4gcGF0aC5yZXNvbHZlKGZpbGVQYXRoLCAnaW5kZXguanMnKVxuICAgICAgICBlbHNlXG4gICAgICAgICAgcmV0dXJuIGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIH1cblxuICAgICAgLy8gVHJ5IGFkZGluZyBhbiBleHRlbnNpb24gdG8gc2VlIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVQYXRoICsgKChmaWxlUGF0aC5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUpKVxuICAgICAgICByZXR1cm4gZmlsZVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICB9LFxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGZpbGVMb2FkZXJcbiIsIi8qIGVzbGludC1kaXNhYmxlIHByZWZlci10ZW1wbGF0ZSAqL1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBodHRwTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9odHRwJ1xuaW1wb3J0IGZpbGVMb2FkZXIgZnJvbSAnLi4vYmx1ZXByaW50cy9sb2FkZXJzL2ZpbGUnXG5cbi8vIE11bHRpLWVudmlyb25tZW50IGFzeW5jIG1vZHVsZSBsb2FkZXJcbmNvbnN0IG1vZHVsZXMgPSB7XG4gICdsb2FkZXJzL2h0dHAnOiBodHRwTG9hZGVyLFxuICAnbG9hZGVycy9maWxlJzogZmlsZUxvYWRlcixcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTmFtZShuYW1lKSB7XG4gIC8vIFRPRE86IGxvb3AgdGhyb3VnaCBlYWNoIGZpbGUgcGF0aCBhbmQgbm9ybWFsaXplIGl0IHRvbzpcbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkvLy5jYXBpdGFsaXplKClcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUZpbGVJbmZvKGZpbGUpIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZpbGVOYW1lID0gbm9ybWFsaXplTmFtZShmaWxlKVxuICBjb25zdCBwcm90b2NvbCA9IHBhcnNlUHJvdG9jb2woZmlsZSlcblxuICByZXR1cm4ge1xuICAgIGZpbGU6IGZpbGUsXG4gICAgcGF0aDogZmlsZSxcbiAgICBuYW1lOiBub3JtYWxpemVkRmlsZU5hbWUsXG4gICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvdG9jb2wobmFtZSkge1xuICAvLyBGSVhNRTogbmFtZSBzaG91bGQgb2YgYmVlbiBub3JtYWxpemVkIGJ5IG5vdy4gRWl0aGVyIHJlbW92ZSB0aGlzIGNvZGUgb3IgbW92ZSBpdCBzb21ld2hlcmUgZWxzZS4uXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxvYWRlciBibHVlcHJpbnQgbmFtZScpXG5cbiAgdmFyIHByb3RvUmVzdWx0cyA9IG5hbWUubWF0Y2goLzpcXC9cXC8vZ2kpICYmIG5hbWUuc3BsaXQoLzpcXC9cXC8vZ2kpXG5cbiAgLy8gTm8gcHJvdG9jb2wgZm91bmQsIGlmIGJyb3dzZXIgZW52aXJvbm1lbnQgdGhlbiBpcyByZWxhdGl2ZSBVUkwgZWxzZSBpcyBhIGZpbGUgcGF0aC4gKFNhbmUgZGVmYXVsdHMgYnV0IGNhbiBiZSBvdmVycmlkZGVuKVxuICBpZiAoIXByb3RvUmVzdWx0cylcbiAgICByZXR1cm4gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/ICdodHRwJyA6ICdmaWxlJ1xuXG4gIHJldHVybiBwcm90b1Jlc3VsdHNbMF1cbn1cblxuZnVuY3Rpb24gcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSkge1xuICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIG1vZHVsZS5jYWxsYmFja3MpIHtcbiAgICBjYWxsYmFjayhtb2R1bGUubW9kdWxlKVxuICB9XG5cbiAgbW9kdWxlLmNhbGxiYWNrcyA9IFtdXG59XG5cbmNvbnN0IGltcG9ydHMgPSBmdW5jdGlvbihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IGZpbGVJbmZvID0gcmVzb2x2ZUZpbGVJbmZvKG5hbWUpXG4gICAgY29uc3QgZmlsZU5hbWUgPSBmaWxlSW5mby5uYW1lXG4gICAgY29uc3QgcHJvdG9jb2wgPSBmaWxlSW5mby5wcm90b2NvbFxuXG4gICAgbG9nKCdsb2FkaW5nIG1vZHVsZTonLCBmaWxlTmFtZSlcblxuICAgIC8vIE1vZHVsZSBoYXMgbG9hZGVkIG9yIHN0YXJ0ZWQgdG8gbG9hZFxuICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXSlcbiAgICAgIGlmIChtb2R1bGVzW2ZpbGVOYW1lXS5sb2FkZWQpXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhtb2R1bGVzW2ZpbGVOYW1lXS5tb2R1bGUpIC8vIFJldHVybiBtb2R1bGUgZnJvbSBDYWNoZVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbW9kdWxlc1tmaWxlTmFtZV0uY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC8vIE5vdCBsb2FkZWQgeWV0LCByZWdpc3RlciBjYWxsYmFja1xuXG4gICAgbW9kdWxlc1tmaWxlTmFtZV0gPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXG4gICAgICBwcm90b2NvbDogcHJvdG9jb2wsXG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgY2FsbGJhY2tzOiBbY2FsbGJhY2tdLFxuICAgIH1cblxuICAgIC8vIEJvb3RzdHJhcHBpbmcgbG9hZGVyIGJsdWVwcmludHMgOylcbiAgICAvL0ZyYW1lKCdMb2FkZXJzLycgKyBwcm90b2NvbCkuZnJvbShmaWxlTmFtZSkudG8oZmlsZU5hbWUsIG9wdHMsIGZ1bmN0aW9uKGVyciwgZXhwb3J0RmlsZSkge30pXG5cbiAgICBjb25zdCBsb2FkZXIgPSAnbG9hZGVycy8nICsgcHJvdG9jb2xcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluaXQoKSAvLyBUT0RPOiBvcHRpb25hbCBpbml0IChpbnNpZGUgRnJhbWUgY29yZSlcbiAgICBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmluKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpe1xuICAgICAgaWYgKGVycilcbiAgICAgICAgbG9nKCdFcnJvcjogJywgZXJyLCBmaWxlTmFtZSlcbiAgICAgIGVsc2Uge1xuICAgICAgICBsb2coJ0xvYWRlZCBCbHVlcHJpbnQgbW9kdWxlOiAnLCBmaWxlTmFtZSlcblxuICAgICAgICBpZiAoIWV4cG9ydEZpbGUgfHwgdHlwZW9mIGV4cG9ydEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IGlzIGV4cGVjdGVkIHRvIGJlIGFuIG9iamVjdCBvciBjbGFzcycpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRGaWxlLm5hbWUgIT09ICdzdHJpbmcnKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBCbHVlcHJpbnQgZmlsZSwgQmx1ZXByaW50IG1pc3NpbmcgYSBuYW1lJylcblxuICAgICAgICBjb25zdCBtb2R1bGUgPSBtb2R1bGVzW2ZpbGVOYW1lXVxuICAgICAgICBpZiAoIW1vZHVsZSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VoIG9oLCB3ZSBzaG91bGRudCBiZSBoZXJlJylcblxuICAgICAgICAvLyBNb2R1bGUgYWxyZWFkeSBsb2FkZWQuIE5vdCBzdXBwb3NlIHRvIGJlIGhlcmUuIE9ubHkgZnJvbSBmb3JjZS1sb2FkaW5nIHdvdWxkIGdldCB5b3UgaGVyZS5cbiAgICAgICAgaWYgKG1vZHVsZS5sb2FkZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXCInICsgZXhwb3J0RmlsZS5uYW1lICsgJ1wiIGFscmVhZHkgbG9hZGVkLicpXG5cbiAgICAgICAgbW9kdWxlLm1vZHVsZSA9IGV4cG9ydEZpbGVcbiAgICAgICAgbW9kdWxlLmxvYWRlZCA9IHRydWVcblxuICAgICAgICBydW5Nb2R1bGVDYWxsYmFja3MobW9kdWxlKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBUT0RPOiBtb2R1bGVzW2xvYWRlcl0ubW9kdWxlLmJ1bmRsZSBzdXBwb3J0IGZvciBDTEkgdG9vbGluZy5cblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBsb2FkIGJsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCdcXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGltcG9ydHNcbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IGV4cG9ydGVyIGZyb20gJy4vZXhwb3J0cydcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJ1xuaW1wb3J0IEJsdWVwcmludE1ldGhvZHMgZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IHsgZGVib3VuY2UsIHByb2Nlc3NGbG93IH0gZnJvbSAnLi9tZXRob2RzJ1xuaW1wb3J0IEJsdWVwcmludEJhc2UgZnJvbSAnLi9CbHVlcHJpbnRCYXNlJ1xuaW1wb3J0IEJsdWVwcmludFNjaGVtYSBmcm9tICcuL3NjaGVtYSdcbmltcG9ydCBpbXBvcnRzIGZyb20gJy4vbG9hZGVyJ1xuXG4vLyBGcmFtZSBhbmQgQmx1ZXByaW50IGNvbnN0cnVjdG9yc1xuY29uc3Qgc2luZ2xldG9ucyA9IHt9XG5mdW5jdGlvbiBGcmFtZShuYW1lLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBGcmFtZSkpXG4gICAgcmV0dXJuIG5ldyBGcmFtZShuYW1lLCBvcHRzKVxuXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbmFtZSBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicpXG5cbiAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgcmV0dXJuIHNpbmdsZXRvbnNbbmFtZV1cblxuICBsZXQgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludChuYW1lKVxuICBpbXBvcnRzKG5hbWUsIG9wdHMsIGZ1bmN0aW9uKGJsdWVwcmludEZpbGUpIHtcbiAgICB0cnkge1xuXG4gICAgICBsb2coJ0JsdWVwcmludCBsb2FkZWQ6JywgYmx1ZXByaW50RmlsZS5uYW1lKVxuXG4gICAgICBpZiAodHlwZW9mIGJsdWVwcmludEZpbGUgIT09ICdvYmplY3QnKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAvLyBVcGRhdGUgZmF1eCBibHVlcHJpbnQgc3R1YiB3aXRoIHJlYWwgbW9kdWxlXG4gICAgICBoZWxwZXJzLmFzc2lnbk9iamVjdChibHVlcHJpbnQsIGJsdWVwcmludEZpbGUpXG5cbiAgICAgIC8vIFVwZGF0ZSBibHVlcHJpbnQgbmFtZVxuICAgICAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgYmx1ZXByaW50RmlsZS5uYW1lLCBmYWxzZSlcbiAgICAgIGJsdWVwcmludC5GcmFtZS5uYW1lID0gYmx1ZXByaW50RmlsZS5uYW1lXG5cbiAgICAgIC8vIEFwcGx5IGEgc2NoZW1hIHRvIGJsdWVwcmludFxuICAgICAgYmx1ZXByaW50ID0gQmx1ZXByaW50U2NoZW1hKGJsdWVwcmludClcblxuICAgICAgLy8gVmFsaWRhdGUgQmx1ZXByaW50IGlucHV0IHdpdGggb3B0aW9uYWwgcHJvcGVydHkgZGVzdHJ1Y3R1cmluZyAodXNpbmcgZGVzY3JpYmUgb2JqZWN0KVxuICAgICAgYmx1ZXByaW50LkZyYW1lLmRlc2NyaWJlID0gaGVscGVycy5jcmVhdGVEZXN0cnVjdHVyZShibHVlcHJpbnQuZGVzY3JpYmUsIEJsdWVwcmludEJhc2UuZGVzY3JpYmUpXG5cbiAgICAgIGJsdWVwcmludC5GcmFtZS5sb2FkZWQgPSB0cnVlXG4gICAgICBkZWJvdW5jZShwcm9jZXNzRmxvdywgMSwgYmx1ZXByaW50KVxuXG4gICAgICAvLyBJZiBibHVlcHJpbnQgaW50ZW5kcyB0byBiZSBhIHNpbmdsZXRvbiwgYWRkIGl0IHRvIHRoZSBsaXN0LlxuICAgICAgaWYgKGJsdWVwcmludC5zaW5nbGV0b24pXG4gICAgICAgIHNpbmdsZXRvbnNbYmx1ZXByaW50Lm5hbWVdID0gYmx1ZXByaW50XG5cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFxcJycgKyBuYW1lICsgJ1xcJyBpcyBub3QgdmFsaWQuXFxuJyArIGVycilcbiAgICB9XG4gIH0pXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnQobmFtZSkge1xuICBjb25zdCBibHVlcHJpbnQgPSBuZXcgQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSlcbiAgaGVscGVycy5zZXREZXNjcmlwdG9yKGJsdWVwcmludCwgJ0JsdWVwcmludCcsIHRydWUpXG5cbiAgLy8gQmx1ZXByaW50IG1ldGhvZHNcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBCbHVlcHJpbnRNZXRob2RzKVxuXG4gIC8vIENyZWF0ZSBoaWRkZW4gYmx1ZXByaW50LkZyYW1lIHByb3BlcnR5IHRvIGtlZXAgc3RhdGVcbiAgY29uc3QgYmx1ZXByaW50QmFzZSA9IE9iamVjdC5jcmVhdGUoQmx1ZXByaW50QmFzZSlcbiAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50QmFzZSwgQmx1ZXByaW50QmFzZSlcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGJsdWVwcmludCwgJ0ZyYW1lJywgeyB2YWx1ZTogYmx1ZXByaW50QmFzZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB3cml0YWJsZTogZmFsc2UgfSkgLy8gVE9ETzogY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2VcbiAgYmx1ZXByaW50LkZyYW1lLm5hbWUgPSBuYW1lXG5cbiAgcmV0dXJuIGJsdWVwcmludFxufVxuXG5mdW5jdGlvbiBCbHVlcHJpbnRDb25zdHJ1Y3RvcihuYW1lKSB7XG4gIC8vIENyZWF0ZSBibHVlcHJpbnQgZnJvbSBjb25zdHJ1Y3RvclxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIGEgc2luZ2xldG9uIChmb3Igc2hhcmVkIHJlc291cmNlcyksIHJldHVybiBpdCBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBpbnN0YW5jZS5cbiAgICBpZiAoc2luZ2xldG9uc1tuYW1lXSlcbiAgICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSBuZXcgRnJhbWUobmFtZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucHJvcHMgPSBhcmd1bWVudHNcblxuICAgIHJldHVybiBibHVlcHJpbnRcbiAgfVxufVxuXG4vLyBHaXZlIEZyYW1lIGFuIGVhc3kgZGVzY3JpcHRvclxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLCAnQ29uc3RydWN0b3InKVxuaGVscGVycy5zZXREZXNjcmlwdG9yKEZyYW1lLmNvbnN0cnVjdG9yLCAnRnJhbWUnKVxuXG4vLyBFeHBvcnQgRnJhbWUgZ2xvYmFsbHlcbmV4cG9ydGVyKCdGcmFtZScsIEZyYW1lKVxuZXhwb3J0IGRlZmF1bHQgRnJhbWVcbiJdLCJuYW1lcyI6WyJoZWxwZXJzLmFzc2lnbk9iamVjdCIsImhlbHBlcnMuc2V0RGVzY3JpcHRvciIsImhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUiXSwibWFwcGluZ3MiOiI7OztFQUVBLFNBQVMsR0FBRyxHQUFHO0VBQ2Y7RUFDQSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDcEMsQ0FBQzs7RUFFRCxHQUFHLENBQUMsS0FBSyxHQUFHLFdBQVc7RUFDdkI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDdEMsRUFBQzs7RUFFRCxHQUFHLENBQUMsSUFBSSxHQUFHLFdBQVc7RUFDdEI7RUFDQSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7RUFDckMsQ0FBQzs7RUNmRDtFQUNBO0VBQ0EsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtFQUM3QjtFQUNBLEVBQUUsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLENBQUMsT0FBTyxLQUFLLFFBQVE7RUFDdEUsSUFBSSxNQUFNLENBQUMsT0FBTyxHQUFHLElBQUc7O0VBRXhCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVE7RUFDaEMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBRzs7RUFFdEI7RUFDQSxPQUFPLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxJQUFJLE1B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
