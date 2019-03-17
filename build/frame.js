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
        blueprint.init = function(_, callback) {
          callback();
        };

      props = destructure(blueprint.Frame.describe.init, props);
      blueprint.init.call(blueprint, props, function(err) {
        if (err)
          return log.error('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

        // Blueprint intitialzed

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWUuanMiLCJzb3VyY2VzIjpbIi4uL2xpYi9sb2dnZXIuanMiLCIuLi9saWIvZXhwb3J0cy5qcyIsIi4uL2xpYi9oZWxwZXJzLmpzIiwiLi4vbGliL2Zsb3cuanMiLCIuLi9saWIvbWV0aG9kcy5qcyIsIi4uL2xpYi9CbHVlcHJpbnRCYXNlLmpzIiwiLi4vbGliL09iamVjdE1vZGVsLmpzIiwiLi4vbGliL3NjaGVtYS5qcyIsIi4uL2xpYi9Nb2R1bGVMb2FkZXIuanMiLCIuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cC5qcyIsIi4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlLmpzIiwiLi4vbGliL2xvYWRlci5qcyIsIi4uL2xpYi9GcmFtZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmxvZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbmxvZy5lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICBjb25zb2xlLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLndhcm4gPSBmdW5jdGlvbigpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgY29uc29sZS53YXJuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxubG9nLmRlYnVnID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuZXhwb3J0IGRlZmF1bHQgbG9nXG4iLCIvLyBVbml2ZXJzYWwgZXhwb3J0IGZ1bmN0aW9uIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cbi8vIEFsdGVybmF0aXZlbHksIGlmIHRoaXMgcHJvdmVzIHRvIGJlIGluZWZmZWN0aXZlLCBkaWZmZXJlbnQgdGFyZ2V0cyBmb3Igcm9sbHVwIGNvdWxkIGJlIGNvbnNpZGVyZWQuXG5mdW5jdGlvbiBleHBvcnRlcihuYW1lLCBvYmopIHtcbiAgLy8gTm9kZS5qcyAmIG5vZGUtbGlrZSBlbnZpcm9ubWVudHMgKGV4cG9ydCBhcyBtb2R1bGUpXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKVxuICAgIG1vZHVsZS5leHBvcnRzID0gb2JqXG5cbiAgLy8gR2xvYmFsIGV4cG9ydCAoYWxzbyBhcHBsaWVkIHRvIE5vZGUgKyBub2RlLWxpa2UgZW52aXJvbm1lbnRzKVxuICBpZiAodHlwZW9mIGdsb2JhbCA9PT0gJ29iamVjdCcpXG4gICAgZ2xvYmFsW25hbWVdID0gb2JqXG5cbiAgLy8gVU1EXG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICBkZWZpbmUoWydleHBvcnRzJ10sIGZ1bmN0aW9uKGV4cCkge1xuICAgICAgZXhwW25hbWVdID0gb2JqXG4gICAgfSlcblxuICAvLyBCcm93c2VycyBhbmQgYnJvd3Nlci1saWtlIGVudmlyb25tZW50cyAoRWxlY3Ryb24sIEh5YnJpZCB3ZWIgYXBwcywgZXRjKVxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JylcbiAgICB3aW5kb3dbbmFtZV0gPSBvYmpcbn1cblxuZXhwb3J0IGRlZmF1bHQgZXhwb3J0ZXJcbiIsIid1c2Ugc3RyaWN0J1xuXG4vLyBPYmplY3QgaGVscGVyIGZ1bmN0aW9uc1xuZnVuY3Rpb24gYXNzaWduT2JqZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkpIHtcbiAgICBpZiAocHJvcGVydHlOYW1lID09PSAnbmFtZScpXG4gICAgICBjb250aW51ZVxuXG4gICAgaWYgKHR5cGVvZiBzb3VyY2VbcHJvcGVydHlOYW1lXSA9PT0gJ29iamVjdCcpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eU5hbWVdID0gW11cbiAgICAgIGVsc2VcbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSBPYmplY3QuY3JlYXRlKHNvdXJjZVtwcm9wZXJ0eU5hbWVdLCBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyhzb3VyY2VbcHJvcGVydHlOYW1lXSkpXG4gICAgZWxzZVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFxuICAgICAgICB0YXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZSxcbiAgICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihzb3VyY2UsIHByb3BlcnR5TmFtZSlcbiAgICAgIClcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gc2V0RGVzY3JpcHRvcih0YXJnZXQsIHZhbHVlLCBjb25maWd1cmFibGUpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgJ3RvU3RyaW5nJywge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgdmFsdWU6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICh2YWx1ZSkgPyAnW0ZyYW1lOiAnICsgdmFsdWUgKyAnXScgOiAnW0ZyYW1lOiBDb25zdHJ1Y3Rvcl0nXG4gICAgfSxcbiAgfSlcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCAnbmFtZScsIHtcbiAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgY29uZmlndXJhYmxlOiAoY29uZmlndXJhYmxlKSA/IHRydWUgOiBmYWxzZSxcbiAgICB2YWx1ZTogdmFsdWUsXG4gIH0pXG59XG5cbi8vIERlc3RydWN0dXJlIHVzZXIgaW5wdXQgZm9yIHBhcmFtZXRlciBkZXN0cnVjdHVyaW5nIGludG8gJ3Byb3BzJyBvYmplY3QuXG5mdW5jdGlvbiBjcmVhdGVEZXN0cnVjdHVyZShzb3VyY2UsIGtleXMpIHtcbiAgY29uc3QgdGFyZ2V0ID0ge31cblxuICAvLyBJZiBubyB0YXJnZXQgZXhpc3QsIHN0dWIgdGhlbSBzbyB3ZSBkb24ndCBydW4gaW50byBpc3N1ZXMgbGF0ZXIuXG4gIGlmICghc291cmNlKVxuICAgIHNvdXJjZSA9IHt9XG5cbiAgLy8gQ3JlYXRlIHN0dWJzIGZvciBBcnJheSBvZiBrZXlzLiBFeGFtcGxlOiBbJ2luaXQnLCAnaW4nLCBldGNdXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICB0YXJnZXRba2V5XSA9IFtdXG4gIH1cblxuICAvLyBMb29wIHRocm91Z2ggc291cmNlJ3Mga2V5c1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzb3VyY2UpKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBbXVxuXG4gICAgLy8gV2Ugb25seSBzdXBwb3J0IG9iamVjdHMgZm9yIG5vdy4gRXhhbXBsZSB7IGluaXQ6IHsgJ3NvbWVLZXknOiAnc29tZURlc2NyaXB0aW9uJyB9fVxuICAgIGlmICh0eXBlb2Ygc291cmNlW2tleV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoc291cmNlW2tleV0pKVxuICAgICAgY29udGludWVcblxuICAgIC8vIFRPRE86IFN1cHBvcnQgYXJyYXlzIGZvciB0eXBlIGNoZWNraW5nXG4gICAgLy8gRXhhbXBsZTogeyBpbml0OiAnc29tZUtleSc6IFsnc29tZSBkZXNjcmlwdGlvbicsICdzdHJpbmcnXSB9XG5cbiAgICBjb25zdCBwcm9wSW5kZXggPSBbXVxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBPYmplY3Qua2V5cyhzb3VyY2Vba2V5XSkpIHtcbiAgICAgIHByb3BJbmRleC5wdXNoKHsgbmFtZTogcHJvcCwgZGVzY3JpcHRpb246IHNvdXJjZVtrZXldW3Byb3BdIH0pXG4gICAgfVxuXG4gICAgdGFyZ2V0W2tleV0gPSBwcm9wSW5kZXhcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZnVuY3Rpb24gZGVzdHJ1Y3R1cmUodGFyZ2V0LCBwcm9wcykge1xuICBjb25zdCBzb3VyY2VQcm9wcyA9ICghcHJvcHMpID8gW10gOiBBcnJheS5mcm9tKHByb3BzKVxuXG4gIGlmICghdGFyZ2V0KVxuICAgIHJldHVybiBzb3VyY2VQcm9wc1xuXG4gIGNvbnN0IHRhcmdldFByb3BzID0ge31cbiAgbGV0IHByb3BJbmRleCA9IDBcblxuICAvLyBMb29wIHRocm91Z2ggb3VyIHRhcmdldCBrZXlzLCBhbmQgYXNzaWduIHRoZSBvYmplY3QncyBrZXkgdG8gdGhlIHZhbHVlIG9mIHRoZSBwcm9wcyBpbnB1dC5cbiAgZm9yIChjb25zdCB0YXJnZXRQcm9wIG9mIHRhcmdldCkge1xuICAgIHRhcmdldFByb3BzW3RhcmdldFByb3AubmFtZV0gPSBzb3VyY2VQcm9wc1twcm9wSW5kZXhdXG4gICAgcHJvcEluZGV4KytcbiAgfVxuXG4gIC8vIElmIHdlIGRvbid0IGhhdmUgYSB2YWxpZCB0YXJnZXQ7IHJldHVybiBwcm9wcyBhcnJheSBpbnN0ZWFkLiBFeGVtcGxlOiBbJ3Byb3AxJywgJ3Byb3AyJ11cbiAgaWYgKHByb3BJbmRleCA9PT0gMClcbiAgICByZXR1cm4gcHJvcHNcblxuICAvLyBFeGFtcGxlOiB7IHNvbWVLZXk6IHNvbWVWYWx1ZSwgc29tZU90aGVyS2V5OiBzb21lT3RoZXJWYWx1ZSB9XG4gIHJldHVybiB0YXJnZXRQcm9wc1xufVxuXG5leHBvcnQge1xuICBhc3NpZ25PYmplY3QsXG4gIHNldERlc2NyaXB0b3IsXG4gIGNyZWF0ZURlc3RydWN0dXJlLFxuICBkZXN0cnVjdHVyZVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgeyBkZXN0cnVjdHVyZSB9IGZyb20gJy4vaGVscGVycydcblxuZnVuY3Rpb24gcHJvY2Vzc0Zsb3coKSB7XG4gIC8vIEFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIEJsdWVwcmludCdzIGZsb3cuXG4gIGlmICh0aGlzLkZyYW1lLnByb2Nlc3NpbmdGbG93KVxuICAgIHJldHVyblxuXG4gIC8vIElmIG5vIHBpcGVzIGZvciBmbG93LCB0aGVuIG5vdGhpbmcgdG8gZG8uXG4gIGlmICh0aGlzLkZyYW1lLnBpcGVzLmxlbmd0aCA8IDEpXG4gICAgcmV0dXJuXG5cbiAgLy8gQ2hlY2sgdGhhdCBhbGwgYmx1ZXByaW50cyBhcmUgcmVhZHlcbiAgaWYgKCFmbG93c1JlYWR5LmNhbGwodGhpcykpXG4gICAgcmV0dXJuXG5cbiAgbG9nLmRlYnVnKCdQcm9jZXNzaW5nIGZsb3cgZm9yICcgKyB0aGlzLm5hbWUpXG4gIGxvZy5kZWJ1ZygpXG4gIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSB0cnVlXG5cbiAgLy8gUHV0IHRoaXMgYmx1ZXByaW50IGF0IHRoZSBiZWdpbm5pbmcgb2YgdGhlIGZsb3csIHRoYXQgd2F5IGFueSAuZnJvbSBldmVudHMgdHJpZ2dlciB0aGUgdG9wIGxldmVsIGZpcnN0LlxuICB0aGlzLkZyYW1lLnBpcGVzLnVuc2hpZnQoeyBkaXJlY3Rpb246ICd0bycsIHRhcmdldDogdGhpcyB9KVxuXG4gIC8vIEJyZWFrIG91dCBldmVudCBwaXBlcyBhbmQgZmxvdyBwaXBlcyBpbnRvIHNlcGFyYXRlIGZsb3dzLlxuICBsZXQgaSA9IDEgLy8gU3RhcnQgYXQgMSwgc2luY2Ugb3VyIHdvcmtlciBibHVlcHJpbnQgaW5zdGFuY2Ugc2hvdWxkIGJlIDBcbiAgZm9yIChjb25zdCBwaXBlIG9mIHRoaXMuRnJhbWUucGlwZXMpIHtcbiAgICBjb25zdCBibHVlcHJpbnQgPSBwaXBlLnRhcmdldFxuXG4gICAgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAnZnJvbScpIHtcbiAgICAgIGlmICh0eXBlb2YgYmx1ZXByaW50Lm9uICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgYmx1ZXByaW50Lm5hbWUgKyAnXFwnIGRvZXMgbm90IHN1cHBvcnQgZXZlbnRzLicpXG4gICAgICBlbHNlIHtcbiAgICAgICAgLy8gLmZyb20oRXZlbnRzKSBzdGFydCB0aGUgZmxvdyBhdCBpbmRleCAwXG4gICAgICAgIHBpcGUuY29udGV4dCA9IGNyZWF0ZUNvbnRleHQodGhpcywgcGlwZS50YXJnZXQsIDApXG4gICAgICAgIHRoaXMuRnJhbWUuZXZlbnRzLnB1c2gocGlwZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHBpcGUuZGlyZWN0aW9uID09PSAndG8nKSB7XG4gICAgICBwaXBlLmNvbnRleHQgPSBjcmVhdGVDb250ZXh0KHRoaXMsIHBpcGUudGFyZ2V0LCBpKVxuICAgICAgdGhpcy5GcmFtZS5mbG93LnB1c2gocGlwZSlcbiAgICAgIGkrK1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0Rmxvdy5jYWxsKHRoaXMpXG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvbnRleHQod29ya2VyLCBibHVlcHJpbnQsIGluZGV4KSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogYmx1ZXByaW50Lm5hbWUsXG4gICAgb3V0OiBibHVlcHJpbnQub3V0LmJpbmQod29ya2VyLCBpbmRleCksXG4gICAgZXJyb3I6IGJsdWVwcmludC5lcnJvci5iaW5kKHdvcmtlciwgaW5kZXgpLFxuICB9XG59XG5cbmZ1bmN0aW9uIGZsb3dzUmVhZHkoKSB7XG4gIC8vIGlmIGJsdWVwcmludCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0IChpLmUuIGNvbnN0cnVjdG9yIG5vdCB1c2VkLilcbiAgaWYgKCF0aGlzLkZyYW1lLmluaXRpYWxpemVkKSB7XG4gICAgaW5pdEJsdWVwcmludC5jYWxsKHRoaXMsIHByb2Nlc3NGbG93KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gTG9vcCB0aHJvdWdoIGFsbCBibHVlcHJpbnRzIGluIGZsb3cgdG8gbWFrZSBzdXJlIHRoZXkgaGF2ZSBiZWVuIGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQuXG4gIGxldCBmbG93c1JlYWR5ID0gdHJ1ZVxuICBmb3IgKGNvbnN0IHBpcGUgb2YgdGhpcy5GcmFtZS5waXBlcykge1xuICAgIGNvbnN0IHRhcmdldCA9IHBpcGUudGFyZ2V0XG5cbiAgICAvLyBOb3QgYSBibHVlcHJpbnQsIGVpdGhlciBhIGZ1bmN0aW9uIG9yIHByaW1pdGl2ZVxuICAgIGlmICh0YXJnZXQuc3R1YilcbiAgICAgIGNvbnRpbnVlXG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5sb2FkZWQpIHtcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXRhcmdldC5GcmFtZS5pbml0aWFsaXplZCkge1xuICAgICAgaW5pdEJsdWVwcmludC5jYWxsKHRhcmdldCwgcHJvY2Vzc0Zsb3cuYmluZCh0aGlzKSlcbiAgICAgIGZsb3dzUmVhZHkgPSBmYWxzZVxuICAgICAgY29udGludWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmxvd3NSZWFkeVxufVxuXG5mdW5jdGlvbiBzdGFydEZsb3coKSB7XG4gIGxvZy5kZWJ1ZygnU3RhcnRpbmcgZmxvdyBmb3IgJyArIHRoaXMubmFtZSlcblxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIHRoaXMuRnJhbWUuZXZlbnRzKSB7XG4gICAgY29uc3QgYmx1ZXByaW50ID0gZXZlbnQudGFyZ2V0XG4gICAgY29uc3QgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUub24sIGV2ZW50LnBhcmFtcylcblxuICAgIC8vIElmIG5vdCBhbHJlYWR5IHByb2Nlc3NpbmcgZmxvdy5cbiAgICBpZiAoYmx1ZXByaW50LkZyYW1lLnBpcGVzICYmIGJsdWVwcmludC5GcmFtZS5waXBlcy5sZW5ndGggPiAwKVxuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcgaXMgbm90IHN0YXJ0aW5nICcgKyBibHVlcHJpbnQubmFtZSArICcsIHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCcpXG4gICAgZWxzZSBpZiAoIWJsdWVwcmludC5GcmFtZS5wcm9jZXNzaW5nRmxvdylcbiAgICAgIGJsdWVwcmludC5vbi5jYWxsKGV2ZW50LmNvbnRleHQsIHByb3BzKVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRCbHVlcHJpbnQoY2FsbGJhY2spIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gdGhpc1xuXG4gIHRyeSB7XG4gICAgbGV0IHByb3BzID0gYmx1ZXByaW50LkZyYW1lLnByb3BzID8gYmx1ZXByaW50LkZyYW1lLnByb3BzIDoge31cblxuICAgIC8vIElmIEJsdWVwcmludCBmb3JlZ29lcyB0aGUgaW5pdGlhbGl6ZXIsIHN0dWIgaXQuXG4gICAgaWYgKCFibHVlcHJpbnQuaW5pdClcbiAgICAgIGJsdWVwcmludC5pbml0ID0gZnVuY3Rpb24oXywgY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soKVxuICAgICAgfVxuXG4gICAgcHJvcHMgPSBkZXN0cnVjdHVyZShibHVlcHJpbnQuRnJhbWUuZGVzY3JpYmUuaW5pdCwgcHJvcHMpXG4gICAgYmx1ZXByaW50LmluaXQuY2FsbChibHVlcHJpbnQsIHByb3BzLCBmdW5jdGlvbihlcnIpIHtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIHJldHVybiBsb2cuZXJyb3IoJ0Vycm9yIGluaXRpYWxpemluZyBibHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJ1xcbicgKyBlcnIpXG5cbiAgICAgIC8vIEJsdWVwcmludCBpbnRpdGlhbHplZFxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgJyArIGJsdWVwcmludC5uYW1lICsgJyBpbnRpYWxpemVkJylcblxuICAgICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0ge31cbiAgICAgIGJsdWVwcmludC5GcmFtZS5pbml0aWFsaXplZCA9IHRydWVcbiAgICAgIGNhbGxiYWNrICYmIGNhbGxiYWNrLmNhbGwoYmx1ZXByaW50KVxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgXFwnJyArIGJsdWVwcmludC5uYW1lICsgJ1xcJyBjb3VsZCBub3QgaW5pdGlhbGl6ZS5cXG4nICsgZXJyKVxuICB9XG59XG5cbmV4cG9ydCB7IHByb2Nlc3NGbG93IH1cbiIsIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJ1xuaW1wb3J0IHsgZGVzdHJ1Y3R1cmUsIGFzc2lnbk9iamVjdCwgc2V0RGVzY3JpcHRvciB9IGZyb20gJy4vaGVscGVycydcbmltcG9ydCB7IHByb2Nlc3NGbG93IH0gZnJvbSAnLi9mbG93J1xuXG4vLyBCbHVlcHJpbnQgTWV0aG9kc1xuY29uc3QgQmx1ZXByaW50TWV0aG9kcyA9IHtcbiAgdG86IGZ1bmN0aW9uKHRhcmdldCkge1xuICAgIHJldHVybiBhZGRQaXBlLmNhbGwodGhpcywgJ3RvJywgdGFyZ2V0LCBBcnJheS5mcm9tKGFyZ3VtZW50cykuc2xpY2UoMSkpXG4gIH0sXG5cbiAgZnJvbTogZnVuY3Rpb24odGFyZ2V0KSB7XG4gICAgcmV0dXJuIGFkZFBpcGUuY2FsbCh0aGlzLCAnZnJvbScsIHRhcmdldCwgQXJyYXkuZnJvbShhcmd1bWVudHMpLnNsaWNlKDEpKVxuICB9LFxuXG4gIG91dDogZnVuY3Rpb24oaW5kZXgsIGRhdGEpIHtcbiAgICBsb2cuZGVidWcodGhpcy5uYW1lICsgJy5vdXQ6JywgZGF0YSwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIG51bGwsIGRhdGFdKVxuICB9LFxuXG4gIGVycm9yOiBmdW5jdGlvbihpbmRleCwgZXJyKSB7XG4gICAgbG9nLmVycm9yKHRoaXMubmFtZSArICcuZXJyb3I6JywgZGF0YSwgYXJndW1lbnRzKVxuICAgIHF1ZXVlKG5leHRQaXBlLCB0aGlzLCBbaW5kZXgsIGVycl0pXG4gIH0sXG5cbiAgZ2V0IHZhbHVlKCkge1xuICAgIC8vIEJhaWwgaWYgd2UncmUgbm90IHJlYWR5LiAoVXNlZCB0byBnZXQgb3V0IG9mIE9iamVjdE1vZGVsIGFuZCBhc3NpZ25PYmplY3QgbGltYm8pXG4gICAgaWYgKCF0aGlzLkZyYW1lKVxuICAgICAgcmV0dXJuICcnXG5cbiAgICBjb25zdCBibHVlcHJpbnQgPSB0aGlzXG4gICAgY29uc3QgcHJvbWlzZUZvclZhbHVlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBibHVlcHJpbnQuRnJhbWUuaXNQcm9taXNlZCA9IHRydWVcbiAgICAgIGJsdWVwcmludC5GcmFtZS5wcm9taXNlID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCB9XG4gICAgfSlcbiAgICByZXR1cm4gcHJvbWlzZUZvclZhbHVlXG4gIH0sXG59XG5cbi8vIEZsb3cgTWV0aG9kIGhlbHBlcnNcbmZ1bmN0aW9uIEJsdWVwcmludFN0dWIodGFyZ2V0KSB7XG4gIGNvbnN0IGJsdWVwcmludCA9IHt9XG4gIGFzc2lnbk9iamVjdChibHVlcHJpbnQsIEJsdWVwcmludE1ldGhvZHMpXG5cbiAgYmx1ZXByaW50LnN0dWIgPSB0cnVlXG4gIGJsdWVwcmludC5GcmFtZSA9IHtcbiAgICBwYXJlbnRzOiBbXSxcbiAgICBkZXNjcmliZTogW10sXG4gIH1cblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnRnVuY3Rpb24nKVxuICAgIGJsdWVwcmludC5pbiA9IHRhcmdldFxuICAgIGJsdWVwcmludC5vbiA9IHRhcmdldFxuICB9IGVsc2Uge1xuICAgIHNldERlc2NyaXB0b3IoYmx1ZXByaW50LCAnUHJpbWl0aXZlJylcbiAgICBibHVlcHJpbnQuaW4gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcuaW46JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgICBibHVlcHJpbnQub24gPSBmdW5jdGlvbiBwcmltaXRpdmVXcmFwcGVyKCkge1xuICAgICAgbG9nLmRlYnVnKHRoaXMubmFtZSArICcub246JywgdGFyZ2V0KVxuICAgICAgdGhpcy5vdXQodGFyZ2V0KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZnVuYywgd2FpdCwgYmx1ZXByaW50LCBhcmdzKSB7XG4gIGNvbnN0IG5hbWUgPSBmdW5jLm5hbWVcbiAgY2xlYXJUaW1lb3V0KGJsdWVwcmludC5GcmFtZS5kZWJvdW5jZVtuYW1lXSlcbiAgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBkZWxldGUgYmx1ZXByaW50LkZyYW1lLmRlYm91bmNlW25hbWVdXG4gICAgZnVuYy5hcHBseShibHVlcHJpbnQsIGFyZ3MpXG4gIH0sIHdhaXQpXG59XG5cbmZ1bmN0aW9uIHF1ZXVlKGZ1bmMsIGJsdWVwcmludCwgYXJncykge1xuICBpZiAoIWJsdWVwcmludC5GcmFtZS5xdWV1ZSlcbiAgICBibHVlcHJpbnQuRnJhbWUucXVldWUgPSBbXVxuXG4gIGJsdWVwcmludC5GcmFtZS5xdWV1ZS5wdXNoKHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgLy8gVE9ETzogQ2xlYW51cCBxdWV1ZVxuICAgIGZ1bmMuYXBwbHkoYmx1ZXByaW50LCBhcmdzKVxuICB9LCAxKSlcbn1cblxuZnVuY3Rpb24gZmFjdG9yeShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgfVxufVxuXG4vLyBQaXBlIGNvbnRyb2xcbmZ1bmN0aW9uIGFkZFBpcGUoZGlyZWN0aW9uLCB0YXJnZXQsIHBhcmFtcykge1xuICBpZiAoIXRoaXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgbWV0aG9kIGNhbGxlZCB3aXRob3V0IGluc3RhbmNlLCBkaWQgeW91IGFzc2lnbiB0aGUgbWV0aG9kIHRvIGEgdmFyaWFibGU/JylcblxuICBpZiAoIXRoaXMuRnJhbWUgfHwgIXRoaXMuRnJhbWUucGlwZXMpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3Qgd29ya2luZyB3aXRoIGEgdmFsaWQgQmx1ZXByaW50IG9iamVjdCcpXG5cbiAgaWYgKCF0YXJnZXQpXG4gICAgdGhyb3cgbmV3IEVycm9yKHRoaXMuRnJhbWUubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKSB3YXMgY2FsbGVkIHdpdGggaW1wcm9wZXIgcGFyYW1ldGVycycpXG5cbiAgaWYgKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHRhcmdldC50byAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRhcmdldCA9IEJsdWVwcmludFN0dWIodGFyZ2V0KVxuICB9IGVsc2UgaWYgKHR5cGVvZiB0YXJnZXQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0YXJnZXQgPSBCbHVlcHJpbnRTdHViKHRhcmdldClcbiAgfVxuXG4gIC8vIEVuc3VyZSB3ZSdyZSB3b3JraW5nIG9uIGEgbmV3IGluc3RhbmNlIG9mIHdvcmtlciBibHVlcHJpbnRcbiAgbGV0IGJsdWVwcmludCA9IHRoaXNcbiAgaWYgKCFibHVlcHJpbnQuRnJhbWUuaW5zdGFuY2UpIHtcbiAgICBibHVlcHJpbnQgPSBibHVlcHJpbnQoKVxuICAgIGJsdWVwcmludC5GcmFtZS5pbnN0YW5jZSA9IHRydWVcbiAgfVxuXG4gIGxvZy5kZWJ1ZyhibHVlcHJpbnQubmFtZSArICcuJyArIGRpcmVjdGlvbiArICcoKTogJyArIHRhcmdldC5uYW1lKVxuICBibHVlcHJpbnQuRnJhbWUucGlwZXMucHVzaCh7IGRpcmVjdGlvbjogZGlyZWN0aW9uLCB0YXJnZXQ6IHRhcmdldCwgcGFyYW1zOiBwYXJhbXMgfSlcblxuICAvLyBVc2VkIHdoZW4gdGFyZ2V0IGJsdWVwcmludCBpcyBwYXJ0IG9mIGFub3RoZXIgZmxvd1xuICBpZiAodGFyZ2V0ICYmIHRhcmdldC5GcmFtZSlcbiAgICB0YXJnZXQuRnJhbWUucGFyZW50cy5wdXNoKHsgdGFyZ2V0OiBibHVlcHJpbnQgfSkgLy8gVE9ETzogQ2hlY2sgaWYgd29ya2VyIGJsdWVwcmludCBpcyBhbHJlYWR5IGFkZGVkLlxuXG4gIGRlYm91bmNlKHByb2Nlc3NGbG93LCAxLCBibHVlcHJpbnQpXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gbmV4dFBpcGUoaW5kZXgsIGVyciwgZGF0YSkge1xuICBsb2cuZGVidWcoJ25leHQ6JywgaW5kZXgpXG4gIGlmIChlcnIpIHtcbiAgICBsb2cuZXJyb3IoJ1RPRE86IGhhbmRsZSBlcnJvcjonLCBlcnIpXG4gICAgdGhpcy5GcmFtZS5wcm9jZXNzaW5nRmxvdyA9IGZhbHNlXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBmbG93ID0gdGhpcy5GcmFtZS5mbG93XG4gIGNvbnN0IG5leHQgPSBmbG93W2luZGV4XVxuXG4gIC8vIElmIHdlJ3JlIGF0IHRoZSBlbmQgb2YgdGhlIGZsb3dcbiAgaWYgKCFuZXh0IHx8ICFuZXh0LnRhcmdldCkge1xuICAgIHRoaXMuRnJhbWUucHJvY2Vzc2luZ0Zsb3cgPSBmYWxzZVxuXG4gICAgaWYgKHRoaXMuRnJhbWUuaXNQcm9taXNlZCkge1xuICAgICAgdGhpcy5GcmFtZS5wcm9taXNlLnJlc29sdmUoZGF0YSlcbiAgICAgIHRoaXMuRnJhbWUuaXNQcm9taXNlZCA9IGZhbHNlXG4gICAgfVxuXG4gICAgLy8gSWYgYmx1ZXByaW50IGlzIHBhcnQgb2YgYW5vdGhlciBmbG93XG4gICAgY29uc3QgcGFyZW50cyA9IHRoaXMuRnJhbWUucGFyZW50c1xuICAgIGlmIChwYXJlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudHMpIHtcbiAgICAgICAgbGV0IGJsdWVwcmludCA9IHBhcmVudC50YXJnZXRcbiAgICAgICAgbG9nLmRlYnVnKCdDYWxsaW5nIHBhcmVudCAnICsgYmx1ZXByaW50Lm5hbWUsICdmb3InLCB0aGlzLm5hbWUpXG4gICAgICAgIHF1ZXVlKG5leHRQaXBlLCBibHVlcHJpbnQsIFswLCBudWxsLCBkYXRhXSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9nLmRlYnVnKCdFbmQgb2YgZmxvdyBmb3InLCB0aGlzLm5hbWUsICdhdCcsIGluZGV4KVxuICB9XG5cbiAgY2FsbE5leHQobmV4dCwgZGF0YSlcbn1cblxuZnVuY3Rpb24gY2FsbE5leHQobmV4dCwgZGF0YSkge1xuICBjb25zdCBibHVlcHJpbnQgPSBuZXh0LnRhcmdldFxuICBjb25zdCBwcm9wcyA9IGRlc3RydWN0dXJlKGJsdWVwcmludC5GcmFtZS5kZXNjcmliZS5pbiwgbmV4dC5wYXJhbXMpXG4gIGNvbnN0IGNvbnRleHQgPSBuZXh0LmNvbnRleHRcbiAgY29uc3QgcmV0VmFsdWUgPSBibHVlcHJpbnQuaW4uY2FsbChjb250ZXh0LCBkYXRhLCBwcm9wcywgbmV3IGZhY3RvcnkocGlwZUNhbGxiYWNrKS5iaW5kKGNvbnRleHQpKVxuICBjb25zdCByZXRUeXBlID0gdHlwZW9mIHJldFZhbHVlXG5cbiAgLy8gQmx1ZXByaW50LmluIGRvZXMgbm90IHJldHVybiBhbnl0aGluZ1xuICBpZiAocmV0VHlwZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgcmV0dXJuXG5cbiAgaWYgKHJldFR5cGUgPT09ICdvYmplY3QnICYmIHJldFZhbHVlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgIC8vIEhhbmRsZSBwcm9taXNlc1xuICAgIHJldFZhbHVlLnRoZW4oY29udGV4dC5vdXQpLmNhdGNoKGNvbnRleHQuZXJyb3IpXG4gIH0gZWxzZSBpZiAocmV0VHlwZSA9PT0gJ29iamVjdCcgJiYgcmV0VmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIC8vIEhhbmRsZSBlcnJvcnNcbiAgICBjb250ZXh0LmVycm9yKHJldFZhbHVlKVxuICB9IGVsc2Uge1xuICAgIC8vIEhhbmRsZSByZWd1bGFyIHByaW1pdGl2ZXMgYW5kIG9iamVjdHNcbiAgICBjb250ZXh0Lm91dChyZXRWYWx1ZSlcbiAgfVxufVxuXG5mdW5jdGlvbiBwaXBlQ2FsbGJhY2soZXJyLCBkYXRhKSB7XG4gIGlmIChlcnIpXG4gICAgcmV0dXJuIHRoaXMuZXJyb3IoZXJyKVxuXG4gIHJldHVybiB0aGlzLm91dChkYXRhKVxufVxuXG5leHBvcnQgZGVmYXVsdCBCbHVlcHJpbnRNZXRob2RzXG5leHBvcnQgeyBCbHVlcHJpbnRNZXRob2RzLCBkZWJvdW5jZSwgcHJvY2Vzc0Zsb3cgfVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIEludGVybmFsIEZyYW1lIHByb3BzXG5jb25zdCBCbHVlcHJpbnRCYXNlID0ge1xuICBuYW1lOiAnJyxcbiAgZGVzY3JpYmU6IFsnaW5pdCcsICdpbicsICdvdXQnXSxcbiAgcHJvcHM6IHt9LFxuXG4gIGxvYWRlZDogZmFsc2UsXG4gIGluaXRpYWxpemVkOiBmYWxzZSxcbiAgcHJvY2Vzc2luZ0Zsb3c6IGZhbHNlLFxuICBkZWJvdW5jZToge30sXG4gIHBhcmVudHM6IFtdLFxuXG4gIGluc3RhbmNlOiBmYWxzZSxcbiAgcGlwZXM6IFtdLFxuICBldmVudHM6IFtdLFxuICBmbG93OiBbXSxcbn1cblxuZXhwb3J0IGRlZmF1bHQgQmx1ZXByaW50QmFzZVxuIiwiJ3VzZSBzdHJpY3QnXG5cbi8vIENvbmNlcHQgYmFzZWQgb246IGh0dHA6Ly9vYmplY3Rtb2RlbC5qcy5vcmcvXG5mdW5jdGlvbiBPYmplY3RNb2RlbChzY2hlbWFPYmopIHtcbiAgaWYgKHR5cGVvZiBzY2hlbWFPYmogPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4geyB0eXBlOiBzY2hlbWFPYmoubmFtZSwgZXhwZWN0czogc2NoZW1hT2JqIH1cbiAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hT2JqICE9PSAnb2JqZWN0JylcbiAgICBzY2hlbWFPYmogPSB7fVxuXG4gIC8vIENsb25lIHNjaGVtYSBvYmplY3Qgc28gd2UgZG9uJ3QgbXV0YXRlIGl0LlxuICBjb25zdCBzY2hlbWEgPSBPYmplY3QuY3JlYXRlKHNjaGVtYU9iailcbiAgT2JqZWN0LmFzc2lnbihzY2hlbWEsIHNjaGVtYU9iailcblxuICAvLyBMb29wIHRocm91Z2ggU2NoZW1hIG9iamVjdCBrZXlzXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNjaGVtYSkpIHtcbiAgICAvLyBDcmVhdGUgYSBzY2hlbWEgb2JqZWN0IHdpdGggdHlwZXNcbiAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnZnVuY3Rpb24nKVxuICAgICAgc2NoZW1hW2tleV0gPSB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiB0eXBlb2Ygc2NoZW1hW2tleV0oKSB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHNjaGVtYVtrZXldID09PSAnb2JqZWN0JyAmJiBBcnJheS5pc0FycmF5KHNjaGVtYVtrZXldKSkge1xuICAgICAgY29uc3Qgc2NoZW1hQXJyID0gc2NoZW1hW2tleV1cbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogZmFsc2UsIHR5cGU6ICdvcHRpb25hbCcsIHR5cGVzOiBbXSB9XG4gICAgICBmb3IgKGNvbnN0IHNjaGVtYVR5cGUgb2Ygc2NoZW1hQXJyKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2NoZW1hVHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBzY2hlbWFba2V5XS50eXBlcy5wdXNoKHR5cGVvZiBzY2hlbWFUeXBlKCkpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc2NoZW1hW2tleV0gPT09ICdvYmplY3QnICYmIHNjaGVtYVtrZXldLnR5cGUpIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogc2NoZW1hW2tleV0udHlwZSwgZXhwZWN0czogc2NoZW1hW2tleV0uZXhwZWN0cyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYVtrZXldID0geyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogdHlwZW9mIHNjaGVtYVtrZXldIH1cbiAgICB9XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgcHJvcHNcbiAgZnVuY3Rpb24gaXNWYWxpZFNjaGVtYShrZXksIHZhbHVlKSB7XG4gICAgLy8gVE9ETzogTWFrZSBtb3JlIGZsZXhpYmxlIGJ5IGRlZmluaW5nIG51bGwgYW5kIHVuZGVmaW5lZCB0eXBlcy5cbiAgICAvLyBObyBzY2hlbWEgZGVmaW5lZCBmb3Iga2V5XG4gICAgaWYgKCFzY2hlbWFba2V5XSlcbiAgICAgIHJldHVybiB0cnVlXG5cbiAgICBpZiAoc2NoZW1hW2tleV0ucmVxdWlyZWQgJiYgdHlwZW9mIHZhbHVlID09PSBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gZWxzZSBpZiAoIXNjaGVtYVtrZXldLnJlcXVpcmVkICYmIHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiAhc2NoZW1hW2tleV0udHlwZXMuaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS5yZXF1aXJlZCAmJiBzY2hlbWFba2V5XS50eXBlKSB7XG4gICAgICBpZiAodHlwZW9mIHNjaGVtYVtrZXldLmV4cGVjdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYVtrZXldLmV4cGVjdHModmFsdWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzY2hlbWEgKG9uY2UgU2NoZW1hIGNvbnN0cnVjdG9yIGlzIGNhbGxlZClcbiAgcmV0dXJuIGZ1bmN0aW9uIHZhbGlkYXRlU2NoZW1hKG9ialRvVmFsaWRhdGUpIHtcbiAgICBjb25zdCBwcm94eU9iaiA9IHt9XG4gICAgY29uc3Qgb2JqID0gb2JqVG9WYWxpZGF0ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqVG9WYWxpZGF0ZSkpIHtcbiAgICAgIGNvbnN0IHByb3BEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmpUb1ZhbGlkYXRlLCBrZXkpXG5cbiAgICAgIC8vIFByb3BlcnR5IGFscmVhZHkgcHJvdGVjdGVkXG4gICAgICBpZiAoIXByb3BEZXNjcmlwdG9yLndyaXRhYmxlIHx8ICFwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCBwcm9wRGVzY3JpcHRvcilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gU2NoZW1hIGRvZXMgbm90IGV4aXN0IGZvciBwcm9wLCBwYXNzdGhyb3VnaFxuICAgICAgaWYgKCFzY2hlbWFba2V5XSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHByb3BEZXNjcmlwdG9yKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBwcm94eU9ialtrZXldID0gb2JqVG9WYWxpZGF0ZVtrZXldXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBwcm9wRGVzY3JpcHRvci5jb25maWd1cmFibGUsXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgfSxcblxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICBpZiAoc2NoZW1hW2tleV0uZXhwZWN0cykge1xuICAgICAgICAgICAgICB2YWx1ZSA9ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSA/IHZhbHVlIDogdHlwZW9mIHZhbHVlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlIGlmIChzY2hlbWFba2V5XS50eXBlID09PSAnb3B0aW9uYWwnKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBvbmUgb2YgXCInICsgc2NoZW1hW2tleV0udHlwZXMgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBhIFwiJyArIHNjaGVtYVtrZXldLnR5cGUgKyAnXCIsIGdvdCBcIicgKyB0eXBlb2YgdmFsdWUgKyAnXCInKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgfSlcblxuICAgICAgLy8gQW55IHNjaGVtYSBsZWZ0b3ZlciBzaG91bGQgYmUgYWRkZWQgYmFjayB0byBvYmplY3QgZm9yIGZ1dHVyZSBwcm90ZWN0aW9uXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzY2hlbWEpKSB7XG4gICAgICAgIGlmIChvYmpba2V5XSlcbiAgICAgICAgICBjb250aW51ZVxuXG4gICAgICAgIHByb3h5T2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgICAgZW51bWVyYWJsZTogcHJvcERlc2NyaXB0b3IuZW51bWVyYWJsZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHByb3BEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSxcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3h5T2JqW2tleV1cbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCFpc1ZhbGlkU2NoZW1hKGtleSwgdmFsdWUpKSB7XG4gICAgICAgICAgICAgIGlmIChzY2hlbWFba2V5XS5leHBlY3RzKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgPyB2YWx1ZSA6IHR5cGVvZiB2YWx1ZVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0aW5nIFwiJyArIGtleSArICdcIiB0byBiZSBcIicgKyBzY2hlbWFba2V5XS50eXBlICsgJ1wiLCBnb3QgXCInICsgdmFsdWUgKyAnXCInKVxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYVtrZXldLnR5cGUgPT09ICdvcHRpb25hbCcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGluZyBcIicgKyBrZXkgKyAnXCIgdG8gYmUgb25lIG9mIFwiJyArIHNjaGVtYVtrZXldLnR5cGVzICsgJ1wiLCBnb3QgXCInICsgdHlwZW9mIHZhbHVlICsgJ1wiJylcbiAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RpbmcgXCInICsga2V5ICsgJ1wiIHRvIGJlIGEgXCInICsgc2NoZW1hW2tleV0udHlwZSArICdcIiwgZ290IFwiJyArIHR5cGVvZiB2YWx1ZSArICdcIicpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3h5T2JqW2tleV0gPSB2YWx1ZVxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgb2JqW2tleV0gPSBvYmpUb1ZhbGlkYXRlW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4gb2JqXG4gIH1cbn1cblxuT2JqZWN0TW9kZWwuU3RyaW5nTm90QmxhbmsgPSBPYmplY3RNb2RlbChmdW5jdGlvbiBTdHJpbmdOb3RCbGFuayhzdHIpIHtcbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKVxuICAgIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiBzdHIudHJpbSgpLmxlbmd0aCA+IDBcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IE9iamVjdE1vZGVsXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IE9iamVjdE1vZGVsIGZyb20gJy4vT2JqZWN0TW9kZWwnXG5cbi8vIFByb3RlY3QgQmx1ZXByaW50IHVzaW5nIGEgc2NoZW1hXG5jb25zdCBCbHVlcHJpbnRTY2hlbWEgPSBuZXcgT2JqZWN0TW9kZWwoe1xuICBuYW1lOiBPYmplY3RNb2RlbC5TdHJpbmdOb3RCbGFuayxcblxuICAvLyBCbHVlcHJpbnQgcHJvdmlkZXNcbiAgaW5pdDogW0Z1bmN0aW9uXSxcbiAgaW46IFtGdW5jdGlvbl0sXG4gIG9uOiBbRnVuY3Rpb25dLFxuICBkZXNjcmliZTogW09iamVjdF0sXG5cbiAgLy8gSW50ZXJuYWxzXG4gIG91dDogRnVuY3Rpb24sXG4gIGVycm9yOiBGdW5jdGlvbixcbiAgY2xvc2U6IFtGdW5jdGlvbl0sXG5cbiAgLy8gVXNlciBmYWNpbmdcbiAgdG86IEZ1bmN0aW9uLFxuICBmcm9tOiBGdW5jdGlvbixcbn0pXG5cbmV4cG9ydCBkZWZhdWx0IEJsdWVwcmludFNjaGVtYVxuIiwiLy8gVE9ETzogTW9kdWxlRmFjdG9yeSgpIGZvciBsb2FkZXIsIHdoaWNoIHBhc3NlcyB0aGUgbG9hZGVyICsgcHJvdG9jb2wgaW50byBpdC4uIFRoYXQgd2F5IGl0J3MgcmVjdXJzaXZlLi4uXG5cbmZ1bmN0aW9uIE1vZHVsZShfX2ZpbGVuYW1lLCBmaWxlQ29udGVudHMsIGNhbGxiYWNrKSB7XG4gIC8vIEZyb20gaWlmZSBjb2RlXG4gIGlmICghZmlsZUNvbnRlbnRzKVxuICAgIF9fZmlsZW5hbWUgPSBfX2ZpbGVuYW1lLnBhdGggfHwgJydcblxuICB2YXIgbW9kdWxlID0ge1xuICAgIGZpbGVuYW1lOiBfX2ZpbGVuYW1lLFxuICAgIGV4cG9ydHM6IHt9LFxuICAgIEJsdWVwcmludDogbnVsbCxcbiAgICByZXNvbHZlOiB7fSxcblxuICAgIHJlcXVpcmU6IGZ1bmN0aW9uKHVybCwgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiB3aW5kb3cuaHR0cC5tb2R1bGUuaW4uY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUsIHVybCwgY2FsbGJhY2spXG4gICAgfSxcbiAgfVxuXG4gIGlmICghY2FsbGJhY2spXG4gICAgcmV0dXJuIG1vZHVsZVxuXG4gIG1vZHVsZS5yZXNvbHZlW21vZHVsZS5maWxlbmFtZV0gPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gICAgY2FsbGJhY2sobnVsbCwgZXhwb3J0cylcbiAgICBkZWxldGUgbW9kdWxlLnJlc29sdmVbbW9kdWxlLmZpbGVuYW1lXVxuICB9XG5cbiAgY29uc3Qgc2NyaXB0ID0gJ21vZHVsZS5yZXNvbHZlW1wiJyArIF9fZmlsZW5hbWUgKyAnXCJdKGZ1bmN0aW9uKGlpZmVNb2R1bGUpe1xcbicgK1xuICAnICB2YXIgbW9kdWxlID0gTW9kdWxlKGlpZmVNb2R1bGUpXFxuJyArXG4gICcgIHZhciBfX2ZpbGVuYW1lID0gbW9kdWxlLmZpbGVuYW1lXFxuJyArXG4gICcgIHZhciBfX2Rpcm5hbWUgPSBfX2ZpbGVuYW1lLnNsaWNlKDAsIF9fZmlsZW5hbWUubGFzdEluZGV4T2YoXCIvXCIpKVxcbicgK1xuICAnICB2YXIgcmVxdWlyZSA9IG1vZHVsZS5yZXF1aXJlXFxuJyArXG4gICcgIHZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJyAgdmFyIHByb2Nlc3MgPSB7IGJyb3dzZXI6IHRydWUgfVxcbicgK1xuICAnICB2YXIgQmx1ZXByaW50ID0gbnVsbDtcXG5cXG4nICtcblxuICAnKGZ1bmN0aW9uKCkge1xcbicgKyAvLyBDcmVhdGUgSUlGRSBmb3IgbW9kdWxlL2JsdWVwcmludFxuICAnXCJ1c2Ugc3RyaWN0XCI7XFxuJyArXG4gICAgZmlsZUNvbnRlbnRzICsgJ1xcbicgK1xuICAnfSkuY2FsbChtb2R1bGUuZXhwb3J0cyk7XFxuJyArIC8vIENyZWF0ZSAndGhpcycgYmluZGluZy5cbiAgJyAgaWYgKEJsdWVwcmludCkgeyByZXR1cm4gQmx1ZXByaW50fVxcbicgK1xuICAnICByZXR1cm4gbW9kdWxlLmV4cG9ydHNcXG4nICtcbiAgJ30obW9kdWxlKSk7J1xuXG4gIHdpbmRvdy5tb2R1bGUgPSBtb2R1bGVcbiAgd2luZG93Lmdsb2JhbCA9IHdpbmRvd1xuICB3aW5kb3cuTW9kdWxlID0gTW9kdWxlXG5cbiAgd2luZG93LnJlcXVpcmUgPSBmdW5jdGlvbih1cmwsIGNhbGxiYWNrKSB7XG4gICAgd2luZG93Lmh0dHAubW9kdWxlLmluaXQuY2FsbCh3aW5kb3cuaHR0cC5tb2R1bGUpXG4gICAgcmV0dXJuIHdpbmRvdy5odHRwLm1vZHVsZS5pbi5jYWxsKHdpbmRvdy5odHRwLm1vZHVsZSwgdXJsLCBjYWxsYmFjaylcbiAgfVxuXG5cbiAgcmV0dXJuIHNjcmlwdFxufVxuXG5leHBvcnQgZGVmYXVsdCBNb2R1bGVcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcbmltcG9ydCBNb2R1bGUgZnJvbSAnLi4vLi4vbGliL01vZHVsZUxvYWRlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuLi8uLi9saWIvZXhwb3J0cydcblxuLy8gRW1iZWRkZWQgaHR0cCBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgaHR0cExvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvaHR0cCcsXG4gIHByb3RvY29sOiAnbG9hZGVyJywgLy8gZW1iZWRkZWQgbG9hZGVyXG5cbiAgLy8gSW50ZXJuYWxzIGZvciBlbWJlZFxuICBsb2FkZWQ6IHRydWUsXG4gIGNhbGxiYWNrczogW10sXG5cbiAgbW9kdWxlOiB7XG4gICAgbmFtZTogJ0hUVFAgTG9hZGVyJyxcbiAgICBwcm90b2NvbDogWydodHRwJywgJ2h0dHBzJywgJ3dlYjovLyddLCAvLyBUT0RPOiBDcmVhdGUgYSB3YXkgZm9yIGxvYWRlciB0byBzdWJzY3JpYmUgdG8gbXVsdGlwbGUgcHJvdG9jb2xzXG5cbiAgICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaXNCcm93c2VyID0gKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSA/IHRydWUgOiBmYWxzZVxuICAgIH0sXG5cbiAgICBpbjogZnVuY3Rpb24oZmlsZU5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICBpZiAoIXRoaXMuaXNCcm93c2VyKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ1VSTCBsb2FkaW5nIHdpdGggbm9kZS5qcyBub3Qgc3VwcG9ydGVkIHlldCAoQ29taW5nIHNvb24hKS4nKVxuXG4gICAgICByZXR1cm4gdGhpcy5icm93c2VyLmxvYWQuY2FsbCh0aGlzLCBmaWxlTmFtZSwgY2FsbGJhY2spXG4gICAgfSxcblxuICAgIG5vcm1hbGl6ZUZpbGVQYXRoOiBmdW5jdGlvbihmaWxlTmFtZSkge1xuICAgICAgaWYgKGZpbGVOYW1lLmluZGV4T2YoJ2h0dHAnKSA+PSAwKVxuICAgICAgICByZXR1cm4gZmlsZU5hbWVcblxuICAgICAgY29uc3QgZmlsZSA9IGZpbGVOYW1lICsgKChmaWxlTmFtZS5pbmRleE9mKCcuanMnKSA9PT0gLTEpID8gJy5qcycgOiAnJylcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gJ2JsdWVwcmludHMvJyArIGZpbGVcbiAgICAgIHJldHVybiBmaWxlUGF0aFxuICAgIH0sXG5cbiAgICBicm93c2VyOiB7XG4gICAgICBsb2FkOiBmdW5jdGlvbihmaWxlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLm5vcm1hbGl6ZUZpbGVQYXRoKGZpbGVOYW1lKVxuICAgICAgICBsb2cuZGVidWcoJ1todHRwIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZVBhdGgpXG5cbiAgICAgICAgdmFyIGlzQXN5bmMgPSB0cnVlXG4gICAgICAgIHZhciBzeW5jRmlsZSA9IG51bGxcbiAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgIGlzQXN5bmMgPSBmYWxzZVxuICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCBmaWxlKSB7XG4gICAgICAgICAgICBpZiAoZXJyKVxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyKVxuXG4gICAgICAgICAgICByZXR1cm4gc3luY0ZpbGUgPSBmaWxlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgICAgLy8gVE9ETzogTmVlZHMgdmFsaWRhdGluZyB0aGF0IGV2ZW50IGhhbmRsZXJzIHdvcmsgYWNyb3NzIGJyb3dzZXJzLiBNb3JlIHNwZWNpZmljYWxseSwgdGhhdCB0aGV5IHJ1biBvbiBFUzUgZW52aXJvbm1lbnRzLlxuICAgICAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvWE1MSHR0cFJlcXVlc3QjQnJvd3Nlcl9jb21wYXRpYmlsaXR5XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IG5ldyB0aGlzLmJyb3dzZXIuc2NyaXB0RXZlbnRzKHRoaXMsIGZpbGVOYW1lLCBjYWxsYmFjaylcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgc2NyaXB0RXZlbnRzLm9uTG9hZClcbiAgICAgICAgc2NyaXB0UmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuXG4gICAgICAgIHNjcmlwdFJlcXVlc3Qub3BlbignR0VUJywgZmlsZVBhdGgsIGlzQXN5bmMpXG4gICAgICAgIHNjcmlwdFJlcXVlc3Quc2VuZChudWxsKVxuXG4gICAgICAgIHJldHVybiBzeW5jRmlsZVxuICAgICAgfSxcblxuICAgICAgc2NyaXB0RXZlbnRzOiBmdW5jdGlvbihsb2FkZXIsIGZpbGVOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5maWxlTmFtZSA9IGZpbGVOYW1lXG4gICAgICAgIHRoaXMub25Mb2FkID0gbG9hZGVyLmJyb3dzZXIub25Mb2FkLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgICB0aGlzLm9uRXJyb3IgPSBsb2FkZXIuYnJvd3Nlci5vbkVycm9yLmNhbGwodGhpcywgbG9hZGVyKVxuICAgICAgfSxcblxuICAgICAgb25Mb2FkOiBmdW5jdGlvbihsb2FkZXIpIHtcbiAgICAgICAgY29uc3Qgc2NyaXB0RXZlbnRzID0gdGhpc1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0UmVxdWVzdCA9IHRoaXNcblxuICAgICAgICAgIGlmIChzY3JpcHRSZXF1ZXN0LnN0YXR1cyA+IDQwMClcbiAgICAgICAgICAgIHJldHVybiBzY3JpcHRFdmVudHMub25FcnJvci5jYWxsKHNjcmlwdFJlcXVlc3QsIHNjcmlwdFJlcXVlc3Quc3RhdHVzVGV4dClcblxuICAgICAgICAgIGNvbnN0IHNjcmlwdENvbnRlbnQgPSBNb2R1bGUoc2NyaXB0UmVxdWVzdC5yZXNwb25zZVVSTCwgc2NyaXB0UmVxdWVzdC5yZXNwb25zZVRleHQsIHNjcmlwdEV2ZW50cy5jYWxsYmFjaylcblxuICAgICAgICAgIHZhciBodG1sID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XG4gICAgICAgICAgdmFyIHNjcmlwdFRhZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpXG4gICAgICAgICAgc2NyaXB0VGFnLnRleHRDb250ZW50ID0gc2NyaXB0Q29udGVudFxuXG4gICAgICAgICAgaHRtbC5hcHBlbmRDaGlsZChzY3JpcHRUYWcpXG4gICAgICAgICAgbG9hZGVyLmJyb3dzZXIuY2xlYW51cChzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cylcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgb25FcnJvcjogZnVuY3Rpb24obG9hZGVyKSB7XG4gICAgICAgIGNvbnN0IHNjcmlwdEV2ZW50cyA9IHRoaXNcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBzY3JpcHRFdmVudHMuZmlsZU5hbWVcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3Qgc2NyaXB0VGFnID0gdGhpc1xuICAgICAgICAgIGxvYWRlci5icm93c2VyLmNsZWFudXAoc2NyaXB0VGFnLCBzY3JpcHRFdmVudHMpXG5cbiAgICAgICAgICAvLyBUcnkgdG8gZmFsbGJhY2sgdG8gaW5kZXguanNcbiAgICAgICAgICAvLyBGSVhNRTogaW5zdGVhZCBvZiBmYWxsaW5nIGJhY2ssIHRoaXMgc2hvdWxkIGJlIHRoZSBkZWZhdWx0IGlmIG5vIGAuanNgIGlzIGRldGVjdGVkLCBidXQgVVJMIHVnbGlmaWVycyBhbmQgc3VjaCB3aWxsIGhhdmUgaXNzdWVzLi4gaHJtbW1tLi5cbiAgICAgICAgICBpZiAoZmlsZU5hbWUuaW5kZXhPZignLmpzJykgPT09IC0xICYmIGZpbGVOYW1lLmluZGV4T2YoJ2luZGV4LmpzJykgPT09IC0xKSB7XG4gICAgICAgICAgICBsb2cud2FybignW2h0dHBdIEF0dGVtcHRpbmcgdG8gZmFsbGJhY2sgdG86ICcsIGZpbGVOYW1lICsgJy9pbmRleC5qcycpXG4gICAgICAgICAgICByZXR1cm4gbG9hZGVyLmluLmNhbGwobG9hZGVyLCBmaWxlTmFtZSArICcvaW5kZXguanMnLCBzY3JpcHRFdmVudHMuY2FsbGJhY2spXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc2NyaXB0RXZlbnRzLmNhbGxiYWNrKCdDb3VsZCBub3QgbG9hZCBCbHVlcHJpbnQnKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBjbGVhbnVwOiBmdW5jdGlvbihzY3JpcHRUYWcsIHNjcmlwdEV2ZW50cykge1xuICAgICAgICBzY3JpcHRUYWcucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIHNjcmlwdEV2ZW50cy5vbkxvYWQpXG4gICAgICAgIHNjcmlwdFRhZy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHNjcmlwdEV2ZW50cy5vbkVycm9yKVxuICAgICAgICAvL2RvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdoZWFkJylbMF0ucmVtb3ZlQ2hpbGQoc2NyaXB0VGFnKSAvLyBUT0RPOiBDbGVhbnVwXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICBub2RlOiB7XG4gICAgICAvLyBTdHViIGZvciBub2RlLmpzIEhUVFAgbG9hZGluZyBzdXBwb3J0LlxuICAgIH0sXG5cbiAgfSxcbn1cblxuZXhwb3J0ZXIoJ2h0dHAnLCBodHRwTG9hZGVyKSAvLyBUT0RPOiBDbGVhbnVwLCBleHBvc2UgbW9kdWxlcyBpbnN0ZWFkXG5cbmV4cG9ydCBkZWZhdWx0IGh0dHBMb2FkZXJcbiIsImltcG9ydCBsb2cgZnJvbSAnLi4vLi4vbGliL2xvZ2dlcidcblxuLy8gRW1iZWRkZWQgZmlsZSBsb2FkZXIgYmx1ZXByaW50LlxuY29uc3QgZmlsZUxvYWRlciA9IHtcbiAgbmFtZTogJ2xvYWRlcnMvZmlsZScsXG4gIHByb3RvY29sOiAnZW1iZWQnLFxuXG4gIC8vIEludGVybmFscyBmb3IgZW1iZWRcbiAgbG9hZGVkOiB0cnVlLFxuICBjYWxsYmFja3M6IFtdLFxuXG4gIG1vZHVsZToge1xuICAgIG5hbWU6ICdGaWxlIExvYWRlcicsXG4gICAgcHJvdG9jb2w6ICdmaWxlJyxcblxuICAgIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5pc0Jyb3dzZXIgPSAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpID8gdHJ1ZSA6IGZhbHNlXG4gICAgfSxcblxuICAgIGluOiBmdW5jdGlvbihmaWxlTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIGlmICh0aGlzLmlzQnJvd3NlcilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlOi8vIGxvYWRpbmcgd2l0aGluIGJyb3dzZXIgbm90IHN1cHBvcnRlZCB5ZXQuIFRyeSByZWxhdGl2ZSBVUkwgaW5zdGVhZC4nKVxuXG4gICAgICBsb2cuZGVidWcoJ1tmaWxlIGxvYWRlcl0gTG9hZGluZyBmaWxlOiAnICsgZmlsZU5hbWUpXG5cbiAgICAgIC8vIFRPRE86IFN3aXRjaCB0byBhc3luYyBmaWxlIGxvYWRpbmcsIGltcHJvdmUgcmVxdWlyZSgpLCBwYXNzIGluIElJRkUgdG8gc2FuZGJveCwgdXNlIElJRkUgcmVzb2x2ZXIgZm9yIGNhbGxiYWNrXG4gICAgICAvLyBUT0RPOiBBZGQgZXJyb3IgcmVwb3J0aW5nLlxuXG4gICAgICBjb25zdCB2bSA9IHJlcXVpcmUoJ3ZtJylcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHRoaXMubm9ybWFsaXplRmlsZVBhdGgoZmlsZU5hbWUpXG5cbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLnJlc29sdmVGaWxlKGZpbGVQYXRoKVxuICAgICAgaWYgKCFmaWxlKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soJ0JsdWVwcmludCBub3QgZm91bmQnKVxuXG4gICAgICBjb25zdCBmaWxlQ29udGVudHMgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZSkudG9TdHJpbmcoKVxuXG4gICAgICAvL2NvbnN0IHNhbmRib3ggPSB7IEJsdWVwcmludDogbnVsbCB9XG4gICAgICAvL3ZtLmNyZWF0ZUNvbnRleHQoc2FuZGJveClcbiAgICAgIC8vdm0ucnVuSW5Db250ZXh0KGZpbGVDb250ZW50cywgc2FuZGJveClcblxuICAgICAgZ2xvYmFsLkJsdWVwcmludCA9IG51bGxcbiAgICAgIHZtLnJ1bkluVGhpc0NvbnRleHQoZmlsZUNvbnRlbnRzKVxuXG4gICAgICBjYWxsYmFjayhudWxsLCBnbG9iYWwuQmx1ZXByaW50KVxuICAgIH0sXG5cbiAgICBub3JtYWxpemVGaWxlUGF0aDogZnVuY3Rpb24oZmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJylcbiAgICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2JsdWVwcmludHMvJywgZmlsZU5hbWUpXG4gICAgfSxcblxuICAgIHJlc29sdmVGaWxlOiBmdW5jdGlvbihmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG4gICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG5cbiAgICAgIC8vIElmIGZpbGUgb3IgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIGJsdWVwcmludCBpcyBhIGRpcmVjdG9yeSBmaXJzdFxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMoZmlsZVBhdGgpLmlzRGlyZWN0b3J5KCkpXG4gICAgICAgICAgcmV0dXJuIHBhdGgucmVzb2x2ZShmaWxlUGF0aCwgJ2luZGV4LmpzJylcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHJldHVybiBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICB9XG5cbiAgICAgIC8vIFRyeSBhZGRpbmcgYW4gZXh0ZW5zaW9uIHRvIHNlZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlUGF0aCArICgoZmlsZVBhdGguaW5kZXhPZignLmpzJykgPT09IC0xKSA/ICcuanMnIDogJycpXG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSlcbiAgICAgICAgcmV0dXJuIGZpbGVcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgfSxcbn1cblxuXG5leHBvcnQgZGVmYXVsdCBmaWxlTG9hZGVyXG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBwcmVmZXItdGVtcGxhdGUgKi9cbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInXG5pbXBvcnQgaHR0cExvYWRlciBmcm9tICcuLi9ibHVlcHJpbnRzL2xvYWRlcnMvaHR0cCdcbmltcG9ydCBmaWxlTG9hZGVyIGZyb20gJy4uL2JsdWVwcmludHMvbG9hZGVycy9maWxlJ1xuXG4vLyBNdWx0aS1lbnZpcm9ubWVudCBhc3luYyBtb2R1bGUgbG9hZGVyXG5jb25zdCBtb2R1bGVzID0ge1xuICAnbG9hZGVycy9odHRwJzogaHR0cExvYWRlcixcbiAgJ2xvYWRlcnMvZmlsZSc6IGZpbGVMb2FkZXIsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5hbWUobmFtZSkge1xuICAvLyBUT0RPOiBsb29wIHRocm91Z2ggZWFjaCBmaWxlIHBhdGggYW5kIG5vcm1hbGl6ZSBpdCB0b286XG4gIHJldHVybiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLy8uY2FwaXRhbGl6ZSgpXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVGaWxlSW5mbyhmaWxlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGaWxlTmFtZSA9IG5vcm1hbGl6ZU5hbWUoZmlsZSlcbiAgY29uc3QgcHJvdG9jb2wgPSBwYXJzZVByb3RvY29sKGZpbGUpXG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlOiBmaWxlLFxuICAgIHBhdGg6IGZpbGUsXG4gICAgbmFtZTogbm9ybWFsaXplZEZpbGVOYW1lLFxuICAgIHByb3RvY29sOiBwcm90b2NvbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVByb3RvY29sKG5hbWUpIHtcbiAgLy8gRklYTUU6IG5hbWUgc2hvdWxkIG9mIGJlZW4gbm9ybWFsaXplZCBieSBub3cuIEVpdGhlciByZW1vdmUgdGhpcyBjb2RlIG9yIG1vdmUgaXQgc29tZXdoZXJlIGVsc2UuLlxuICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsb2FkZXIgYmx1ZXByaW50IG5hbWUnKVxuXG4gIHZhciBwcm90b1Jlc3VsdHMgPSBuYW1lLm1hdGNoKC86XFwvXFwvL2dpKSAmJiBuYW1lLnNwbGl0KC86XFwvXFwvL2dpKVxuXG4gIC8vIE5vIHByb3RvY29sIGZvdW5kLCBpZiBicm93c2VyIGVudmlyb25tZW50IHRoZW4gaXMgcmVsYXRpdmUgVVJMIGVsc2UgaXMgYSBmaWxlIHBhdGguIChTYW5lIGRlZmF1bHRzIGJ1dCBjYW4gYmUgb3ZlcnJpZGRlbilcbiAgaWYgKCFwcm90b1Jlc3VsdHMpXG4gICAgcmV0dXJuICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JykgPyAnaHR0cCcgOiAnZmlsZSdcblxuICByZXR1cm4gcHJvdG9SZXN1bHRzWzBdXG59XG5cbmZ1bmN0aW9uIHJ1bk1vZHVsZUNhbGxiYWNrcyhtb2R1bGUpIHtcbiAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBtb2R1bGUuY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2sobW9kdWxlLm1vZHVsZSlcbiAgfVxuXG4gIG1vZHVsZS5jYWxsYmFja3MgPSBbXVxufVxuXG5jb25zdCBpbXBvcnRzID0gZnVuY3Rpb24obmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlSW5mbyA9IHJlc29sdmVGaWxlSW5mbyhuYW1lKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gZmlsZUluZm8ubmFtZVxuICAgIGNvbnN0IHByb3RvY29sID0gZmlsZUluZm8ucHJvdG9jb2xcblxuICAgIGxvZy5kZWJ1ZygnbG9hZGluZyBtb2R1bGU6JywgZmlsZU5hbWUpXG5cbiAgICAvLyBNb2R1bGUgaGFzIGxvYWRlZCBvciBzdGFydGVkIHRvIGxvYWRcbiAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0pXG4gICAgICBpZiAobW9kdWxlc1tmaWxlTmFtZV0ubG9hZGVkKVxuICAgICAgICByZXR1cm4gY2FsbGJhY2sobW9kdWxlc1tmaWxlTmFtZV0ubW9kdWxlKSAvLyBSZXR1cm4gbW9kdWxlIGZyb20gQ2FjaGVcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG1vZHVsZXNbZmlsZU5hbWVdLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAvLyBOb3QgbG9hZGVkIHlldCwgcmVnaXN0ZXIgY2FsbGJhY2tcblxuICAgIG1vZHVsZXNbZmlsZU5hbWVdID0ge1xuICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxuICAgICAgcHJvdG9jb2w6IHByb3RvY29sLFxuICAgICAgbG9hZGVkOiBmYWxzZSxcbiAgICAgIGNhbGxiYWNrczogW2NhbGxiYWNrXSxcbiAgICB9XG5cbiAgICAvLyBCb290c3RyYXBwaW5nIGxvYWRlciBibHVlcHJpbnRzIDspXG4gICAgLy9GcmFtZSgnTG9hZGVycy8nICsgcHJvdG9jb2wpLmZyb20oZmlsZU5hbWUpLnRvKGZpbGVOYW1lLCBvcHRzLCBmdW5jdGlvbihlcnIsIGV4cG9ydEZpbGUpIHt9KVxuXG4gICAgY29uc3QgbG9hZGVyID0gJ2xvYWRlcnMvJyArIHByb3RvY29sXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbml0KCkgLy8gVE9ETzogb3B0aW9uYWwgaW5pdCAoaW5zaWRlIEZyYW1lIGNvcmUpXG4gICAgbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5pbihmaWxlTmFtZSwgb3B0cywgZnVuY3Rpb24oZXJyLCBleHBvcnRGaWxlKXtcbiAgICAgIGlmIChlcnIpXG4gICAgICAgIGxvZy5lcnJvcignRXJyb3I6ICcsIGVyciwgZmlsZU5hbWUpXG4gICAgICBlbHNlIHtcbiAgICAgICAgbG9nLmRlYnVnKCdMb2FkZWQgQmx1ZXByaW50IG1vZHVsZTogJywgZmlsZU5hbWUpXG5cbiAgICAgICAgaWYgKCFleHBvcnRGaWxlIHx8IHR5cGVvZiBleHBvcnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBpcyBleHBlY3RlZCB0byBiZSBhbiBvYmplY3Qgb3IgY2xhc3MnKVxuXG4gICAgICAgIGlmICh0eXBlb2YgZXhwb3J0RmlsZS5uYW1lICE9PSAnc3RyaW5nJylcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQmx1ZXByaW50IGZpbGUsIEJsdWVwcmludCBtaXNzaW5nIGEgbmFtZScpXG5cbiAgICAgICAgY29uc3QgbW9kdWxlID0gbW9kdWxlc1tmaWxlTmFtZV1cbiAgICAgICAgaWYgKCFtb2R1bGUpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVaCBvaCwgd2Ugc2hvdWxkbnQgYmUgaGVyZScpXG5cbiAgICAgICAgLy8gTW9kdWxlIGFscmVhZHkgbG9hZGVkLiBOb3Qgc3VwcG9zZSB0byBiZSBoZXJlLiBPbmx5IGZyb20gZm9yY2UtbG9hZGluZyB3b3VsZCBnZXQgeW91IGhlcmUuXG4gICAgICAgIGlmIChtb2R1bGUubG9hZGVkKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IFwiJyArIGV4cG9ydEZpbGUubmFtZSArICdcIiBhbHJlYWR5IGxvYWRlZC4nKVxuXG4gICAgICAgIG1vZHVsZS5tb2R1bGUgPSBleHBvcnRGaWxlXG4gICAgICAgIG1vZHVsZS5sb2FkZWQgPSB0cnVlXG5cbiAgICAgICAgcnVuTW9kdWxlQ2FsbGJhY2tzKG1vZHVsZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gVE9ETzogbW9kdWxlc1tsb2FkZXJdLm1vZHVsZS5idW5kbGUgc3VwcG9ydCBmb3IgQ0xJIHRvb2xpbmcuXG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgbG9hZCBibHVlcHJpbnQgXFwnJyArIG5hbWUgKyAnXFwnXFxuJyArIGVycilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBpbXBvcnRzXG4iLCIndXNlIHN0cmljdCdcblxuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBleHBvcnRlciBmcm9tICcuL2V4cG9ydHMnXG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycydcbmltcG9ydCBCbHVlcHJpbnRNZXRob2RzIGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCB7IGRlYm91bmNlLCBwcm9jZXNzRmxvdyB9IGZyb20gJy4vbWV0aG9kcydcbmltcG9ydCBCbHVlcHJpbnRCYXNlIGZyb20gJy4vQmx1ZXByaW50QmFzZSdcbmltcG9ydCBCbHVlcHJpbnRTY2hlbWEgZnJvbSAnLi9zY2hlbWEnXG5pbXBvcnQgaW1wb3J0cyBmcm9tICcuL2xvYWRlcidcblxuLy8gRnJhbWUgYW5kIEJsdWVwcmludCBjb25zdHJ1Y3RvcnNcbmNvbnN0IHNpbmdsZXRvbnMgPSB7fVxuZnVuY3Rpb24gRnJhbWUobmFtZSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRnJhbWUpKVxuICAgIHJldHVybiBuZXcgRnJhbWUobmFtZSwgb3B0cylcblxuICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKVxuICAgIHRocm93IG5ldyBFcnJvcignQmx1ZXByaW50IG5hbWUgXFwnJyArIG5hbWUgKyAnXFwnIGlzIG5vdCB2YWxpZC5cXG4nKVxuXG4gIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gIGlmIChzaW5nbGV0b25zW25hbWVdKVxuICAgIHJldHVybiBzaW5nbGV0b25zW25hbWVdXG5cbiAgbGV0IGJsdWVwcmludCA9IG5ldyBCbHVlcHJpbnQobmFtZSlcbiAgaW1wb3J0cyhuYW1lLCBvcHRzLCBmdW5jdGlvbihibHVlcHJpbnRGaWxlKSB7XG4gICAgdHJ5IHtcblxuICAgICAgbG9nLmRlYnVnKCdCbHVlcHJpbnQgbG9hZGVkOicsIGJsdWVwcmludEZpbGUubmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBibHVlcHJpbnRGaWxlICE9PSAnb2JqZWN0JylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCbHVlcHJpbnQgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gb2JqZWN0IG9yIGNsYXNzJylcblxuICAgICAgLy8gVXBkYXRlIGZhdXggYmx1ZXByaW50IHN0dWIgd2l0aCByZWFsIG1vZHVsZVxuICAgICAgaGVscGVycy5hc3NpZ25PYmplY3QoYmx1ZXByaW50LCBibHVlcHJpbnRGaWxlKVxuXG4gICAgICAvLyBVcGRhdGUgYmx1ZXByaW50IG5hbWVcbiAgICAgIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsIGJsdWVwcmludEZpbGUubmFtZSwgZmFsc2UpXG4gICAgICBibHVlcHJpbnQuRnJhbWUubmFtZSA9IGJsdWVwcmludEZpbGUubmFtZVxuXG4gICAgICAvLyBBcHBseSBhIHNjaGVtYSB0byBibHVlcHJpbnRcbiAgICAgIGJsdWVwcmludCA9IEJsdWVwcmludFNjaGVtYShibHVlcHJpbnQpXG5cbiAgICAgIC8vIFZhbGlkYXRlIEJsdWVwcmludCBpbnB1dCB3aXRoIG9wdGlvbmFsIHByb3BlcnR5IGRlc3RydWN0dXJpbmcgKHVzaW5nIGRlc2NyaWJlIG9iamVjdClcbiAgICAgIGJsdWVwcmludC5GcmFtZS5kZXNjcmliZSA9IGhlbHBlcnMuY3JlYXRlRGVzdHJ1Y3R1cmUoYmx1ZXByaW50LmRlc2NyaWJlLCBCbHVlcHJpbnRCYXNlLmRlc2NyaWJlKVxuXG4gICAgICBibHVlcHJpbnQuRnJhbWUubG9hZGVkID0gdHJ1ZVxuICAgICAgZGVib3VuY2UocHJvY2Vzc0Zsb3csIDEsIGJsdWVwcmludClcblxuICAgICAgLy8gSWYgYmx1ZXByaW50IGludGVuZHMgdG8gYmUgYSBzaW5nbGV0b24sIGFkZCBpdCB0byB0aGUgbGlzdC5cbiAgICAgIGlmIChibHVlcHJpbnQuc2luZ2xldG9uKVxuICAgICAgICBzaW5nbGV0b25zW2JsdWVwcmludC5uYW1lXSA9IGJsdWVwcmludFxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JsdWVwcmludCBcXCcnICsgbmFtZSArICdcXCcgaXMgbm90IHZhbGlkLlxcbicgKyBlcnIpXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50KG5hbWUpIHtcbiAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEJsdWVwcmludENvbnN0cnVjdG9yKG5hbWUpXG4gIGhlbHBlcnMuc2V0RGVzY3JpcHRvcihibHVlcHJpbnQsICdCbHVlcHJpbnQnLCB0cnVlKVxuXG4gIC8vIEJsdWVwcmludCBtZXRob2RzXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludCwgQmx1ZXByaW50TWV0aG9kcylcblxuICAvLyBDcmVhdGUgaGlkZGVuIGJsdWVwcmludC5GcmFtZSBwcm9wZXJ0eSB0byBrZWVwIHN0YXRlXG4gIGNvbnN0IGJsdWVwcmludEJhc2UgPSBPYmplY3QuY3JlYXRlKEJsdWVwcmludEJhc2UpXG4gIGhlbHBlcnMuYXNzaWduT2JqZWN0KGJsdWVwcmludEJhc2UsIEJsdWVwcmludEJhc2UpXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShibHVlcHJpbnQsICdGcmFtZScsIHsgdmFsdWU6IGJsdWVwcmludEJhc2UsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgd3JpdGFibGU6IGZhbHNlIH0pIC8vIFRPRE86IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlXG4gIGJsdWVwcmludC5GcmFtZS5uYW1lID0gbmFtZVxuXG4gIHJldHVybiBibHVlcHJpbnRcbn1cblxuZnVuY3Rpb24gQmx1ZXByaW50Q29uc3RydWN0b3IobmFtZSkge1xuICAvLyBDcmVhdGUgYmx1ZXByaW50IGZyb20gY29uc3RydWN0b3JcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIC8vIElmIGJsdWVwcmludCBpcyBhIHNpbmdsZXRvbiAoZm9yIHNoYXJlZCByZXNvdXJjZXMpLCByZXR1cm4gaXQgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgaW5zdGFuY2UuXG4gICAgaWYgKHNpbmdsZXRvbnNbbmFtZV0pXG4gICAgICByZXR1cm4gc2luZ2xldG9uc1tuYW1lXVxuXG4gICAgY29uc3QgYmx1ZXByaW50ID0gbmV3IEZyYW1lKG5hbWUpXG4gICAgYmx1ZXByaW50LkZyYW1lLnByb3BzID0gYXJndW1lbnRzXG5cbiAgICByZXR1cm4gYmx1ZXByaW50XG4gIH1cbn1cblxuLy8gR2l2ZSBGcmFtZSBhbiBlYXN5IGRlc2NyaXB0b3JcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZSwgJ0NvbnN0cnVjdG9yJylcbmhlbHBlcnMuc2V0RGVzY3JpcHRvcihGcmFtZS5jb25zdHJ1Y3RvciwgJ0ZyYW1lJylcblxuLy8gRXhwb3J0IEZyYW1lIGdsb2JhbGx5XG5leHBvcnRlcignRnJhbWUnLCBGcmFtZSlcbmV4cG9ydCBkZWZhdWx0IEZyYW1lXG4iXSwibmFtZXMiOlsiaGVscGVycy5hc3NpZ25PYmplY3QiLCJoZWxwZXJzLnNldERlc2NyaXB0b3IiLCJoZWxwZXJzLmNyZWF0ZURlc3RydWN0dXJlIl0sIm1hcHBpbmdzIjoiOzs7RUFFQSxTQUFTLEdBQUcsR0FBRztFQUNmO0VBQ0EsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3BDLENBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCO0VBQ0EsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3RDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLElBQUksR0FBRyxXQUFXO0VBQ3RCO0VBQ0EsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO0VBQ3JDLEVBQUM7O0VBRUQsR0FBRyxDQUFDLEtBQUssR0FBRyxXQUFXO0VBQ3ZCLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztFQUNwQyxDQUFDOztFQ25CRDtFQUNBO0VBQ0EsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtFQUM3QjtFQUNBLEVBQUUsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLENBQUMsT0FBTyxLQUFLLFFBQVE7RUFDdEUsSUFBSSxNQUFNLENBQUMsT0FBTyxHQUFHLElBQUc7O0VBRXhCO0VBQ0EsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVE7RUFDaEMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBRzs7RUFFdEI7RUFDQSxPQUFPLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxJQUFJLE1BQU0sQ0FBQyxHQUFHO0VBQ3JELElBQUksTUFBTSxDQUFDLENBQUMsU0FBUyxDQUFDLEVBQUUsU0FBUyxHQUFHLEVBQUU7RUFDdEMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBRztFQUNyQixLQUFLLEVBQUM7O0VBRU47RUFDQSxPQUFPLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtFQUNyQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFHO0VBQ3RCLENBQUM7O0VDbEJEO0VBQ0EsU0FBUyxZQUFZLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRTtFQUN0QyxFQUFFLEtBQUssTUFBTSxZQUFZLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxFQUFFO0VBQ2pFLElBQUksSUFBSSxZQUFZLEtBQUssTUFBTTtFQUMvQixNQUFNLFFBQVE7O0VBRWQsSUFBSSxJQUFJLE9BQU8sTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLFFBQVE7RUFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0VBQzdDLFFBQVEsTUFBTSxDQUFDLFlBQVksQ0FBQyxHQUFHLEdBQUU7RUFDakM7RUFDQSxRQUFRLE1BQU0sQ0FBQyxZQUFZLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxNQUFNLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLEVBQUM7RUFDMUg7RUFDQSxNQUFNLE1BQU0sQ0FBQyxjQUFjO0VBQzNCLFFBQVEsTUFBTTtFQUNkLFFBQVEsWUFBWTtFQUNwQixRQUFRLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDO0VBQzdELFFBQU87RUFDUCxHQUFHOztFQUVILEVBQUUsT0FBTyxNQUFNO0VBQ2YsQ0FBQzs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRTtFQUNwRCxFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRTtFQUM1QyxJQUFJLFVBQVUsRUFBRSxLQUFLO0VBQ3JCLElBQUksUUFBUSxFQUFFLEtBQUs7RUFDbkIsSUFBSSxZQUFZLEVBQUUsSUFBSTtFQUN0QixJQUFJLEtBQUssRUFBRSxXQUFXO0VBQ3RCLE1BQU0sT0FBTyxDQUFDLEtBQUssSUFBSSxVQUFVLEdBQUcsS0FBSyxHQUFHLEdBQUcsR0FBRyxzQkFBc0I7RUFDeEUsS0FBSztFQUNMLEdBQUcsRUFBQzs7RUFFSixFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRTtFQUN4QyxJQUFJLFVBQVUsRUFBRSxLQUFLO0VBQ3JCLElBQUksUUFBUSxFQUFFLEtBQUs7RUFDbkIsSUFBSSxZQUFZLEVBQUUsQ0FBQyxZQUFZLElBQUksSUFBSSxHQUFHLEtBQUs7RUFDL0MsSUFBSSxLQUFLLEVBQUUsS0FBSztFQUNoQixHQUFHLEVBQUM7RUFDSixDQUFDOztFQUVEO0VBQ0EsU0FBUyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFO0VBQ3pDLEVBQUUsTUFBTSxNQUFNLEdBQUcsR0FBRTs7RUFFbkI7RUFDQSxFQUFFLElBQUksQ0FBQyxNQUFNO0VBQ2IsSUFBSSxNQUFNLEdBQUcsR0FBRTs7RUFFZjtFQUNBLEVBQUUsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUU7RUFDMUIsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRTtFQUNwQixHQUFHOztFQUVIO0VBQ0EsRUFBRSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUU7RUFDekMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRTs7RUFFcEI7RUFDQSxJQUFJLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0VBQ3JFLE1BQU0sUUFBUTs7RUFFZDtFQUNBOztFQUVBLElBQUksTUFBTSxTQUFTLEdBQUcsR0FBRTtFQUN4QixJQUFJLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUNqRCxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBQztFQUNwRSxLQUFLOztFQUVMLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFVBQVM7RUFDM0IsR0FBRzs7RUFFSCxFQUFFLE9BQU8sTUFBTTtFQUNmLENBQUM7O0VBRUQsU0FBUyxXQUFXLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRTtFQUNwQyxFQUFFLE1BQU0sV0FBVyxHQUFHLENBQUMsQ0FBQyxLQUFLLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFDOztFQUV2RCxFQUFFLElBQUksQ0FBQyxNQUFNO0VBQ2IsSUFBSSxPQUFPLFdBQVc7O0VBRXRCLEVBQUUsTUFBTSxXQUFXLEdBQUcsR0FBRTtFQUN4QixFQUFFLElBQUksU0FBUyxHQUFHLEVBQUM7O0VBRW5CO0VBQ0EsRUFBRSxLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sRUFBRTtFQUNuQyxJQUFJLFdBQVcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLFNBQVMsRUFBQztFQUN6RCxJQUFJLFNBQVMsR0FBRTtFQUNmLEdBQUc7O0VBRUg7RUFDQSxFQUFFLElBQUksU0FBUyxLQUFLLENBQUM7RUFDckIsSUFBSSxPQUFPLEtBQUs7O0VBRWhCO0VBQ0EsRUFBRSxPQUFPLFdBQVc7RUFDcEIsQ0FBQzs7RUM3RkQsU0FBUyxXQUFXLEdBQUc7O0lBRXJCLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjO01BQzNCLE1BQU07OztJQUdSLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7TUFDN0IsTUFBTTs7O0lBR1IsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO01BQ3hCLE1BQU07SUFJUixJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxLQUFJOzs7SUFHaEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUM7OztJQUczRCxJQUFJLENBQUMsR0FBRyxFQUFDO0lBQ1QsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRTtNQUNuQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsT0FBTTs7TUFFN0IsSUFBSSxJQUFJLENBQUMsU0FBUyxLQUFLLE1BQU0sRUFBRTtRQUM3QixJQUFJLE9BQU8sU0FBUyxDQUFDLEVBQUUsS0FBSyxVQUFVO1VBQ3BDLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQyxJQUFJLEdBQUcsNkJBQTZCLENBQUM7YUFDN0U7O1VBRUgsSUFBSSxDQUFDLE9BQU8sR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFDO1VBQ2xELElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUM7U0FDN0I7T0FDRixNQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsS0FBSyxJQUFJLEVBQUU7UUFDbEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFDO1FBQ2xELElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUM7UUFDMUIsQ0FBQyxHQUFFO09BQ0o7S0FDRjs7SUFFRCxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQztHQUNyQjs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRTtJQUMvQyxPQUFPO01BQ0wsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJO01BQ3BCLEdBQUcsRUFBRSxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDO01BQ3RDLEtBQUssRUFBRSxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDO0tBQzNDO0dBQ0Y7O0VBRUQsU0FBUyxVQUFVLEdBQUc7O0lBRXBCLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRTtNQUMzQixhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUM7TUFDckMsT0FBTyxLQUFLO0tBQ2I7OztJQUdELElBQUksVUFBVSxHQUFHLEtBQUk7SUFDckIsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRTtNQUNuQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsT0FBTTs7O01BRzFCLElBQUksTUFBTSxDQUFDLElBQUk7UUFDYixRQUFROztNQUVWLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRTtRQUN4QixVQUFVLEdBQUcsTUFBSztRQUNsQixRQUFRO09BQ1Q7O01BRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFO1FBQzdCLGFBQWEsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUM7UUFDbEQsVUFBVSxHQUFHLE1BQUs7UUFDbEIsUUFBUTtPQUNUO0tBQ0Y7O0lBRUQsT0FBTyxVQUFVO0dBQ2xCOztFQUVELFNBQVMsU0FBUyxHQUFHOztJQUduQixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFO01BQ3JDLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFNO01BQzlCLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBQzs7O01BR3BFLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7UUFDM0QsQ0FBMEY7V0FDdkYsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsY0FBYztRQUN0QyxTQUFTLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBQztLQUMxQztHQUNGOztFQUVELFNBQVMsYUFBYSxDQUFDLFFBQVEsRUFBRTtJQUMvQixNQUFNLFNBQVMsR0FBRyxLQUFJOztJQUV0QixJQUFJO01BQ0YsSUFBSSxLQUFLLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsR0FBRTs7O01BRzlELElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSTtRQUNqQixTQUFTLENBQUMsSUFBSSxHQUFHLFNBQVMsQ0FBQyxFQUFFLFFBQVEsRUFBRTtVQUNyQyxRQUFRLEdBQUU7VUFDWDs7TUFFSCxLQUFLLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUM7TUFDekQsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxTQUFTLEdBQUcsRUFBRTtRQUNsRCxJQUFJLEdBQUc7VUFDTCxPQUFPLEdBQUcsQ0FBQyxLQUFLLENBQUMsaUNBQWlDLEdBQUcsU0FBUyxDQUFDLElBQUksR0FBRyxNQUFNLEdBQUcsR0FBRyxDQUFDOzs7O1FBS3JGLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxHQUFHLEdBQUU7UUFDMUIsU0FBUyxDQUFDLEtBQUssQ0FBQyxXQUFXLEdBQUcsS0FBSTtRQUNsQyxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUM7T0FDckMsRUFBQzs7S0FFSCxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFDLElBQUksR0FBRyw0QkFBNEIsR0FBRyxHQUFHLENBQUM7S0FDdEY7R0FDRjs7O0VDM0hELE1BQU0sZ0JBQWdCLEdBQUc7SUFDdkIsRUFBRSxFQUFFLFNBQVMsTUFBTSxFQUFFO01BQ25CLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUN4RTs7SUFFRCxJQUFJLEVBQUUsU0FBUyxNQUFNLEVBQUU7TUFDckIsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQzFFOztJQUVELEdBQUcsRUFBRSxTQUFTLEtBQUssRUFBRSxJQUFJLEVBQUU7TUFFekIsS0FBSyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFDO0tBQzNDOztJQUVELEtBQUssRUFBRSxTQUFTLEtBQUssRUFBRSxHQUFHLEVBQUU7TUFDMUIsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLFNBQVMsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDO01BQ2pELEtBQUssQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFDO0tBQ3BDOztJQUVELElBQUksS0FBSyxHQUFHOztNQUVWLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSztRQUNiLE9BQU8sRUFBRTs7TUFFWCxNQUFNLFNBQVMsR0FBRyxLQUFJO01BQ3RCLE1BQU0sZUFBZSxHQUFHLElBQUksT0FBTyxDQUFDLFNBQVMsT0FBTyxFQUFFLE1BQU0sRUFBRTtRQUM1RCxTQUFTLENBQUMsS0FBSyxDQUFDLFVBQVUsR0FBRyxLQUFJO1FBQ2pDLFNBQVMsQ0FBQyxLQUFLLENBQUMsT0FBTyxHQUFHLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxHQUFFO09BQy9ELEVBQUM7TUFDRixPQUFPLGVBQWU7S0FDdkI7SUFDRjs7O0VBR0QsU0FBUyxhQUFhLENBQUMsTUFBTSxFQUFFO0lBQzdCLE1BQU0sU0FBUyxHQUFHLEdBQUU7SUFDcEIsWUFBWSxDQUFDLFNBQVMsRUFBRSxnQkFBZ0IsRUFBQzs7SUFFekMsU0FBUyxDQUFDLElBQUksR0FBRyxLQUFJO0lBQ3JCLFNBQVMsQ0FBQyxLQUFLLEdBQUc7TUFDaEIsT0FBTyxFQUFFLEVBQUU7TUFDWCxRQUFRLEVBQUUsRUFBRTtNQUNiOztJQUVELElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxFQUFFO01BQ2hDLGFBQWEsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFDO01BQ3BDLFNBQVMsQ0FBQyxFQUFFLEdBQUcsT0FBTTtNQUNyQixTQUFTLENBQUMsRUFBRSxHQUFHLE9BQU07S0FDdEIsTUFBTTtNQUNMLGFBQWEsQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFDO01BQ3JDLFNBQVMsQ0FBQyxFQUFFLEdBQUcsU0FBUyxnQkFBZ0IsR0FBRztRQUV6QyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBQztRQUNqQjtNQUNELFNBQVMsQ0FBQyxFQUFFLEdBQUcsU0FBUyxnQkFBZ0IsR0FBRztRQUV6QyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBQztRQUNqQjtLQUNGOztJQUVELE9BQU8sU0FBUztHQUNqQjs7RUFFRCxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUU7SUFDN0MsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUk7SUFDdEIsWUFBWSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFDO0lBQzVDLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLFVBQVUsQ0FBQyxXQUFXO01BQ3JELE9BQU8sU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFDO01BQ3JDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFLElBQUksRUFBQztLQUM1QixFQUFFLElBQUksRUFBQztHQUNUOztFQUVELFNBQVMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFO0lBQ3BDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUs7TUFDeEIsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsR0FBRTs7SUFFNUIsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXOztNQUUvQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUM7S0FDNUIsRUFBRSxDQUFDLENBQUMsRUFBQztHQUNQOztFQUVELFNBQVMsT0FBTyxDQUFDLEVBQUUsRUFBRTtJQUNuQixPQUFPLFdBQVc7TUFDaEIsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7S0FDakM7R0FDRjs7O0VBR0QsU0FBUyxPQUFPLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUU7SUFDMUMsSUFBSSxDQUFDLElBQUk7TUFDUCxNQUFNLElBQUksS0FBSyxDQUFDLG9GQUFvRixDQUFDOztJQUV2RyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSztNQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxDQUFDOztJQUU5RCxJQUFJLENBQUMsTUFBTTtNQUNULE1BQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsR0FBRyxHQUFHLFNBQVMsR0FBRyx3Q0FBd0MsQ0FBQzs7SUFFL0YsSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksT0FBTyxNQUFNLENBQUMsRUFBRSxLQUFLLFVBQVUsRUFBRTtNQUNuRSxNQUFNLEdBQUcsYUFBYSxDQUFDLE1BQU0sRUFBQztLQUMvQixNQUFNLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVSxFQUFFO01BQ3ZDLE1BQU0sR0FBRyxhQUFhLENBQUMsTUFBTSxFQUFDO0tBQy9COzs7SUFHRCxJQUFJLFNBQVMsR0FBRyxLQUFJO0lBQ3BCLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRTtNQUM3QixTQUFTLEdBQUcsU0FBUyxHQUFFO01BQ3ZCLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUk7S0FDaEM7SUFHRCxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFDOzs7SUFHcEYsSUFBSSxNQUFNLElBQUksTUFBTSxDQUFDLEtBQUs7TUFDeEIsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxFQUFDOztJQUVsRCxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUM7SUFDbkMsT0FBTyxTQUFTO0dBQ2pCOztFQUVELFNBQVMsUUFBUSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFO0lBRWxDLElBQUksR0FBRyxFQUFFO01BQ1AsR0FBRyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxHQUFHLEVBQUM7TUFDckMsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsTUFBSztNQUNqQyxNQUFNO0tBQ1A7O0lBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFJO0lBQzVCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUM7OztJQUd4QixJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtNQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxNQUFLOztNQUVqQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFO1FBQ3pCLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUM7UUFDaEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsTUFBSztPQUM5Qjs7O01BR0QsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFPO01BQ2xDLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDdEIsS0FBSyxNQUFNLE1BQU0sSUFBSSxPQUFPLEVBQUU7VUFDNUIsSUFBSSxTQUFTLEdBQUcsTUFBTSxDQUFDLE9BQU07VUFFN0IsS0FBSyxDQUFDLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFDO1NBQzVDO09BQ0Y7O01BRUQsT0FBTyxNQUFvRDtLQUM1RDs7SUFFRCxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksRUFBQztHQUNyQjs7RUFFRCxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQzVCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxPQUFNO0lBQzdCLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBQztJQUNuRSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBTztJQUM1QixNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUM7SUFDakcsTUFBTSxPQUFPLEdBQUcsT0FBTyxTQUFROzs7SUFHL0IsSUFBSSxPQUFPLEtBQUssV0FBVztNQUN6QixNQUFNOztJQUVSLElBQUksT0FBTyxLQUFLLFFBQVEsSUFBSSxRQUFRLFlBQVksT0FBTyxFQUFFOztNQUV2RCxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBQztLQUNoRCxNQUFNLElBQUksT0FBTyxLQUFLLFFBQVEsSUFBSSxRQUFRLFlBQVksS0FBSyxFQUFFOztNQUU1RCxPQUFPLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBQztLQUN4QixNQUFNOztNQUVMLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFDO0tBQ3RCO0dBQ0Y7O0VBRUQsU0FBUyxZQUFZLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRTtJQUMvQixJQUFJLEdBQUc7TUFDTCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDOztJQUV4QixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDO0dBQ3RCOztFQ2hNRDtFQUNBLE1BQU0sYUFBYSxHQUFHO0VBQ3RCLEVBQUUsSUFBSSxFQUFFLEVBQUU7RUFDVixFQUFFLFFBQVEsRUFBRSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDO0VBQ2pDLEVBQUUsS0FBSyxFQUFFLEVBQUU7O0VBRVgsRUFBRSxNQUFNLEVBQUUsS0FBSztFQUNmLEVBQUUsV0FBVyxFQUFFLEtBQUs7RUFDcEIsRUFBRSxjQUFjLEVBQUUsS0FBSztFQUN2QixFQUFFLFFBQVEsRUFBRSxFQUFFO0VBQ2QsRUFBRSxPQUFPLEVBQUUsRUFBRTs7RUFFYixFQUFFLFFBQVEsRUFBRSxLQUFLO0VBQ2pCLEVBQUUsS0FBSyxFQUFFLEVBQUU7RUFDWCxFQUFFLE1BQU0sRUFBRSxFQUFFO0VBQ1osRUFBRSxJQUFJLEVBQUUsRUFBRTtFQUNWLENBQUM7O0VDaEJEO0VBQ0EsU0FBUyxXQUFXLENBQUMsU0FBUyxFQUFFO0VBQ2hDLEVBQUUsSUFBSSxPQUFPLFNBQVMsS0FBSyxVQUFVLEVBQUU7RUFDdkMsSUFBSSxPQUFPLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRTtFQUN2RCxHQUFHLE1BQU0sSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRO0VBQzFDLElBQUksU0FBUyxHQUFHLEdBQUU7O0VBRWxCO0VBQ0EsRUFBRSxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBQztFQUN6QyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLFNBQVMsRUFBQzs7RUFFbEM7RUFDQSxFQUFFLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRTtFQUN6QztFQUNBLElBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxVQUFVO0VBQ3pDLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRTtFQUNsRSxTQUFTLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDNUUsTUFBTSxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsR0FBRyxFQUFDO0VBQ25DLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUU7RUFDcEUsTUFBTSxLQUFLLE1BQU0sVUFBVSxJQUFJLFNBQVMsRUFBRTtFQUMxQyxRQUFRLElBQUksT0FBTyxVQUFVLEtBQUssVUFBVTtFQUM1QyxVQUFVLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sVUFBVSxFQUFFLEVBQUM7RUFDckQsT0FBTztFQUNQLEtBQUssTUFBTSxJQUFJLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ3BFLE1BQU0sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sR0FBRTtFQUM1RixLQUFLLE1BQU07RUFDWCxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFFO0VBQ2hFLEtBQUs7RUFDTCxHQUFHOztFQUVIO0VBQ0EsRUFBRSxTQUFTLGFBQWEsQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFO0VBQ3JDO0VBQ0E7RUFDQSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDO0VBQ3BCLE1BQU0sT0FBTyxJQUFJOztFQUVqQixJQUFJLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsSUFBSSxPQUFPLEtBQUssS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFO0VBQ25FLE1BQU0sT0FBTyxJQUFJO0VBQ2pCLEtBQUssTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLFVBQVUsRUFBRTtFQUN6RSxNQUFNLElBQUksS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxLQUFLLENBQUM7RUFDNUQsUUFBUSxPQUFPLEtBQUs7O0VBRXBCLE1BQU0sT0FBTyxJQUFJO0VBQ2pCLEtBQUssTUFBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRTtFQUN6RCxNQUFNLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxLQUFLLFVBQVUsRUFBRTtFQUNyRCxRQUFRLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7RUFDekMsT0FBTztFQUNQLEtBQUs7O0VBRUwsSUFBSSxPQUFPLEtBQUs7RUFDaEIsR0FBRzs7RUFFSDtFQUNBLEVBQUUsT0FBTyxTQUFTLGNBQWMsQ0FBQyxhQUFhLEVBQUU7RUFDaEQsSUFBSSxNQUFNLFFBQVEsR0FBRyxHQUFFO0VBQ3ZCLElBQUksTUFBTSxHQUFHLEdBQUcsY0FBYTs7RUFFN0IsSUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxhQUFhLENBQUMsRUFBRTtFQUNqRSxNQUFNLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxhQUFhLEVBQUUsR0FBRyxFQUFDOztFQUVoRjtFQUNBLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLElBQUksQ0FBQyxjQUFjLENBQUMsWUFBWSxFQUFFO0VBQ3BFLFFBQVEsTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLGNBQWMsRUFBQztFQUN2RCxRQUFRLFFBQVE7RUFDaEIsT0FBTzs7RUFFUDtFQUNBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRTtFQUN4QixRQUFRLE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxjQUFjLEVBQUM7RUFDdkQsUUFBUSxRQUFRO0VBQ2hCLE9BQU87O0VBRVAsTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsYUFBYSxDQUFDLEdBQUcsRUFBQztFQUN4QyxNQUFNLE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRTtFQUN0QyxRQUFRLFVBQVUsRUFBRSxjQUFjLENBQUMsVUFBVTtFQUM3QyxRQUFRLFlBQVksRUFBRSxjQUFjLENBQUMsWUFBWTtFQUNqRCxRQUFRLEdBQUcsRUFBRSxXQUFXO0VBQ3hCLFVBQVUsT0FBTyxRQUFRLENBQUMsR0FBRyxDQUFDO0VBQzlCLFNBQVM7O0VBRVQsUUFBUSxHQUFHLEVBQUUsU0FBUyxLQUFLLEVBQUU7RUFDN0IsVUFBVSxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRTtFQUMxQyxZQUFZLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRTtFQUNyQyxjQUFjLEtBQUssR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEdBQUcsT0FBTyxNQUFLO0VBQ3hFLGNBQWMsTUFBTSxJQUFJLEtBQUssQ0FBQyxhQUFhLEdBQUcsR0FBRyxHQUFHLFdBQVcsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLFVBQVUsR0FBRyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQzlHLGFBQWEsTUFBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFO0VBQ3hELGNBQWMsTUFBTSxJQUFJLEtBQUssQ0FBQyxhQUFhLEdBQUcsR0FBRyxHQUFHLGtCQUFrQixHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEdBQUcsVUFBVSxHQUFHLE9BQU8sS0FBSyxHQUFHLEdBQUcsQ0FBQztFQUM3SCxhQUFhO0VBQ2IsY0FBYyxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsYUFBYSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxHQUFHLE9BQU8sS0FBSyxHQUFHLEdBQUcsQ0FBQztFQUN2SCxXQUFXOztFQUVYLFVBQVUsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQUs7RUFDL0IsVUFBVSxPQUFPLEtBQUs7RUFDdEIsU0FBUztFQUNULE9BQU8sRUFBQzs7RUFFUjtFQUNBLE1BQU0sS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLEVBQUU7RUFDNUQsUUFBUSxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUM7RUFDcEIsVUFBVSxRQUFROztFQUVsQixRQUFRLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxhQUFhLENBQUMsR0FBRyxFQUFDO0VBQzFDLFFBQVEsTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFO0VBQ3hDLFVBQVUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVO0VBQy9DLFVBQVUsWUFBWSxFQUFFLGNBQWMsQ0FBQyxZQUFZO0VBQ25ELFVBQVUsR0FBRyxFQUFFLFdBQVc7RUFDMUIsWUFBWSxPQUFPLFFBQVEsQ0FBQyxHQUFHLENBQUM7RUFDaEMsV0FBVzs7RUFFWCxVQUFVLEdBQUcsRUFBRSxTQUFTLEtBQUssRUFBRTtFQUMvQixZQUFZLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFO0VBQzVDLGNBQWMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFO0VBQ3ZDLGdCQUFnQixLQUFLLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxHQUFHLE9BQU8sTUFBSztFQUMxRSxnQkFBZ0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxhQUFhLEdBQUcsR0FBRyxHQUFHLFdBQVcsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLFVBQVUsR0FBRyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQ2hILGVBQWUsTUFBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFO0VBQzFELGdCQUFnQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsR0FBRyxHQUFHLEdBQUcsa0JBQWtCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxDQUFDO0VBQy9ILGVBQWU7RUFDZixnQkFBZ0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxhQUFhLEdBQUcsR0FBRyxHQUFHLGFBQWEsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLFVBQVUsR0FBRyxPQUFPLEtBQUssR0FBRyxHQUFHLENBQUM7RUFDekgsYUFBYTs7RUFFYixZQUFZLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFLO0VBQ2pDLFlBQVksT0FBTyxLQUFLO0VBQ3hCLFdBQVc7RUFDWCxTQUFTLEVBQUM7RUFDVixPQUFPOztFQUVQLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxHQUFHLEVBQUM7RUFDbkMsS0FBSzs7RUFFTCxJQUFJLE9BQU8sR0FBRztFQUNkLEdBQUc7RUFDSCxDQUFDOztFQUVELFdBQVcsQ0FBQyxjQUFjLEdBQUcsV0FBVyxDQUFDLFNBQVMsY0FBYyxDQUFDLEdBQUcsRUFBRTtFQUN0RSxFQUFFLElBQUksT0FBTyxHQUFHLEtBQUssUUFBUTtFQUM3QixJQUFJLE9BQU8sS0FBSzs7RUFFaEIsRUFBRSxPQUFPLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQztFQUM5QixDQUFDLENBQUM7O0VDeklGO0VBQ0EsTUFBTSxlQUFlLEdBQUcsSUFBSSxXQUFXLENBQUM7RUFDeEMsRUFBRSxJQUFJLEVBQUUsV0FBVyxDQUFDLGNBQWM7O0VBRWxDO0VBQ0EsRUFBRSxJQUFJLEVBQUUsQ0FBQyxRQUFRLENBQUM7RUFDbEIsRUFBRSxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUM7RUFDaEIsRUFBRSxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUM7RUFDaEIsRUFBRSxRQUFRLEVBQUUsQ0FBQyxNQUFNLENBQUM7O0VBRXBCO0VBQ0EsRUFBRSxHQUFHLEVBQUUsUUFBUTtFQUNmLEVBQUUsS0FBSyxFQUFFLFFBQVE7RUFDakIsRUFBRSxLQUFLLEVBQUUsQ0FBQyxRQUFRLENBQUM7O0VBRW5CO0VBQ0EsRUFBRSxFQUFFLEVBQUUsUUFBUTtFQUNkLEVBQUUsSUFBSSxFQUFFLFFBQVE7RUFDaEIsQ0FBQyxDQUFDOztFQ3RCRjs7RUFFQSxTQUFTLE1BQU0sQ0FBQyxVQUFVLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRTtFQUNwRDtFQUNBLEVBQUUsSUFBSSxDQUFDLFlBQVk7RUFDbkIsSUFBSSxVQUFVLEdBQUcsVUFBVSxDQUFDLElBQUksSUFBSSxHQUFFOztFQUV0QyxFQUFFLElBQUksTUFBTSxHQUFHO0VBQ2YsSUFBSSxRQUFRLEVBQUUsVUFBVTtFQUN4QixJQUFJLE9BQU8sRUFBRSxFQUFFO0VBQ2YsSUFBSSxTQUFTLEVBQUUsSUFBSTtFQUNuQixJQUFJLE9BQU8sRUFBRSxFQUFFOztFQUVmLElBQUksT0FBTyxFQUFFLFNBQVMsR0FBRyxFQUFFLFFBQVEsRUFBRTtFQUNyQyxNQUFNLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsUUFBUSxDQUFDO0VBQzFFLEtBQUs7RUFDTCxJQUFHOztFQUVILEVBQUUsSUFBSSxDQUFDLFFBQVE7RUFDZixJQUFJLE9BQU8sTUFBTTs7RUFFakIsRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxTQUFTLE9BQU8sRUFBRTtFQUN0RCxJQUFJLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFDO0VBQzNCLElBQUksT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUM7RUFDMUMsSUFBRzs7RUFFSCxFQUFFLE1BQU0sTUFBTSxHQUFHLGtCQUFrQixHQUFHLFVBQVUsR0FBRyw0QkFBNEI7RUFDL0UsRUFBRSxxQ0FBcUM7RUFDdkMsRUFBRSxzQ0FBc0M7RUFDeEMsRUFBRSxzRUFBc0U7RUFDeEUsRUFBRSxrQ0FBa0M7RUFDcEMsRUFBRSxrQ0FBa0M7RUFDcEMsRUFBRSxxQ0FBcUM7RUFDdkMsRUFBRSw2QkFBNkI7O0VBRS9CLEVBQUUsaUJBQWlCO0VBQ25CLEVBQUUsaUJBQWlCO0VBQ25CLElBQUksWUFBWSxHQUFHLElBQUk7RUFDdkIsRUFBRSw0QkFBNEI7RUFDOUIsRUFBRSx3Q0FBd0M7RUFDMUMsRUFBRSwyQkFBMkI7RUFDN0IsRUFBRSxjQUFhOztFQUVmLEVBQUUsTUFBTSxDQUFDLE1BQU0sR0FBRyxPQUFNO0VBQ3hCLEVBQUUsTUFBTSxDQUFDLE1BQU0sR0FBRyxPQUFNO0VBQ3hCLEVBQUUsTUFBTSxDQUFDLE1BQU0sR0FBRyxPQUFNOztFQUV4QixFQUFFLE1BQU0sQ0FBQyxPQUFPLEdBQUcsU0FBUyxHQUFHLEVBQUUsUUFBUSxFQUFFO0VBQzNDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBQztFQUNwRCxJQUFJLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsUUFBUSxDQUFDO0VBQ3hFLElBQUc7OztFQUdILEVBQUUsT0FBTyxNQUFNO0VBQ2YsQ0FBQzs7O0VDakRELE1BQU0sVUFBVSxHQUFHO0lBQ2pCLElBQUksRUFBRSxjQUFjO0lBQ3BCLFFBQVEsRUFBRSxRQUFROzs7SUFHbEIsTUFBTSxFQUFFLElBQUk7SUFDWixTQUFTLEVBQUUsRUFBRTs7SUFFYixNQUFNLEVBQUU7TUFDTixJQUFJLEVBQUUsYUFBYTtNQUNuQixRQUFRLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLFFBQVEsQ0FBQzs7TUFFckMsSUFBSSxFQUFFLFdBQVc7UUFDZixJQUFJLENBQUMsU0FBUyxHQUFHLENBQUMsT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLElBQUksR0FBRyxNQUFLO09BQzdEOztNQUVELEVBQUUsRUFBRSxTQUFTLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO1FBQ3JDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUztVQUNqQixPQUFPLFFBQVEsQ0FBQyw0REFBNEQsQ0FBQzs7UUFFL0UsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUM7T0FDeEQ7O01BRUQsaUJBQWlCLEVBQUUsU0FBUyxRQUFRLEVBQUU7UUFDcEMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUM7VUFDL0IsT0FBTyxRQUFROztRQUVqQixNQUFNLElBQUksR0FBRyxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssR0FBRyxFQUFFLEVBQUM7UUFDdkUsTUFBTSxRQUFRLEdBQUcsYUFBYSxHQUFHLEtBQUk7UUFDckMsT0FBTyxRQUFRO09BQ2hCOztNQUVELE9BQU8sRUFBRTtRQUNQLElBQUksRUFBRSxTQUFTLFFBQVEsRUFBRSxRQUFRLEVBQUU7VUFDakMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsRUFBQzs7VUFHakQsSUFBSSxPQUFPLEdBQUcsS0FBSTtVQUNsQixJQUFJLFFBQVEsR0FBRyxLQUFJO1VBQ25CLElBQUksQ0FBQyxRQUFRLEVBQUU7WUFDYixPQUFPLEdBQUcsTUFBSztZQUNmLFFBQVEsR0FBRyxTQUFTLEdBQUcsRUFBRSxJQUFJLEVBQUU7Y0FDN0IsSUFBSSxHQUFHO2dCQUNMLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDOztjQUV0QixPQUFPLFFBQVEsR0FBRyxJQUFJO2NBQ3ZCO1dBQ0Y7O1VBRUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxjQUFjLEdBQUU7Ozs7VUFJMUMsTUFBTSxZQUFZLEdBQUcsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQztVQUM1RSxhQUFhLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxNQUFNLEVBQUM7VUFDM0QsYUFBYSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsT0FBTyxFQUFDOztVQUU3RCxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFDO1VBQzVDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFDOztVQUV4QixPQUFPLFFBQVE7U0FDaEI7O1FBRUQsWUFBWSxFQUFFLFNBQVMsTUFBTSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUU7VUFDakQsSUFBSSxDQUFDLFFBQVEsR0FBRyxTQUFRO1VBQ3hCLElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUTtVQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFDO1VBQ3RELElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUM7U0FDekQ7O1FBRUQsTUFBTSxFQUFFLFNBQVMsTUFBTSxFQUFFO1VBQ3ZCLE1BQU0sWUFBWSxHQUFHLEtBQUk7VUFDekIsT0FBTyxXQUFXO1lBQ2hCLE1BQU0sYUFBYSxHQUFHLEtBQUk7O1lBRTFCLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxHQUFHO2NBQzVCLE9BQU8sWUFBWSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxVQUFVLENBQUM7O1lBRTNFLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUMsV0FBVyxFQUFFLGFBQWEsQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDLFFBQVEsRUFBQzs7WUFFMUcsSUFBSSxJQUFJLEdBQUcsUUFBUSxDQUFDLGdCQUFlO1lBQ25DLElBQUksU0FBUyxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFDO1lBQ2hELFNBQVMsQ0FBQyxXQUFXLEdBQUcsY0FBYTs7WUFFckMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUM7WUFDM0IsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLFlBQVksRUFBQztXQUNoRDtTQUNGOztRQUVELE9BQU8sRUFBRSxTQUFTLE1BQU0sRUFBRTtVQUN4QixNQUFNLFlBQVksR0FBRyxLQUFJO1VBQ3pCLE1BQU0sUUFBUSxHQUFHLFlBQVksQ0FBQyxTQUFROztVQUV0QyxPQUFPLFdBQVc7WUFDaEIsTUFBTSxTQUFTLEdBQUcsS0FBSTtZQUN0QixNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsWUFBWSxFQUFDOzs7O1lBSS9DLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO2NBQ3pFLEdBQUcsQ0FBQyxJQUFJLENBQUMsb0NBQW9DLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBQztjQUN0RSxPQUFPLE1BQU0sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxRQUFRLEdBQUcsV0FBVyxFQUFFLFlBQVksQ0FBQyxRQUFRLENBQUM7YUFDN0U7O1lBRUQsWUFBWSxDQUFDLFFBQVEsQ0FBQywwQkFBMEIsRUFBQztXQUNsRDtTQUNGOztRQUVELE9BQU8sRUFBRSxTQUFTLFNBQVMsRUFBRSxZQUFZLEVBQUU7VUFDekMsU0FBUyxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUMsTUFBTSxFQUFDO1VBQzFELFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLE9BQU8sRUFBQzs7U0FFN0Q7T0FDRjs7TUFFRCxJQUFJLEVBQUU7O09BRUw7O0tBRUY7SUFDRjs7RUFFRCxRQUFRLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBQzs7O0VDNUg1QixNQUFNLFVBQVUsR0FBRztJQUNqQixJQUFJLEVBQUUsY0FBYztJQUNwQixRQUFRLEVBQUUsT0FBTzs7O0lBR2pCLE1BQU0sRUFBRSxJQUFJO0lBQ1osU0FBUyxFQUFFLEVBQUU7O0lBRWIsTUFBTSxFQUFFO01BQ04sSUFBSSxFQUFFLGFBQWE7TUFDbkIsUUFBUSxFQUFFLE1BQU07O01BRWhCLElBQUksRUFBRSxXQUFXO1FBQ2YsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFDLE9BQU8sTUFBTSxLQUFLLFFBQVEsSUFBSSxJQUFJLEdBQUcsTUFBSztPQUM3RDs7TUFFRCxFQUFFLEVBQUUsU0FBUyxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTtRQUNyQyxJQUFJLElBQUksQ0FBQyxTQUFTO1VBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkVBQTZFLENBQUM7Ozs7O1FBT2hHLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLEVBQUM7UUFDeEIsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBQzs7UUFFeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsRUFBQzs7UUFFakQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUM7UUFDdkMsSUFBSSxDQUFDLElBQUk7VUFDUCxPQUFPLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQzs7UUFFeEMsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEdBQUU7Ozs7OztRQU1yRCxNQUFNLENBQUMsU0FBUyxHQUFHLEtBQUk7UUFDdkIsRUFBRSxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBQzs7UUFFakMsUUFBUSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsU0FBUyxFQUFDO09BQ2pDOztNQUVELGlCQUFpQixFQUFFLFNBQVMsUUFBUSxFQUFFO1FBQ3BDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUM7UUFDNUIsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFDO09BQzVEOztNQUVELFdBQVcsRUFBRSxTQUFTLFFBQVEsRUFBRTtRQUM5QixNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUM7OztRQUc1QixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLEVBQUU7O1VBRTNCLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxXQUFXLEVBQUU7WUFDckMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUM7O1lBRXpDLE9BQU8sUUFBUSxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDO1NBQ3BFOzs7UUFHRCxNQUFNLElBQUksR0FBRyxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssR0FBRyxFQUFFLEVBQUM7UUFDdkUsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztVQUNyQixPQUFPLElBQUk7O1FBRWIsT0FBTyxLQUFLO09BQ2I7S0FDRjtHQUNGOztFQzNFRDtBQUNBOztFQUtBLE1BQU0sT0FBTyxHQUFHO0lBQ2QsY0FBYyxFQUFFLFVBQVU7SUFDMUIsY0FBYyxFQUFFLFVBQVU7SUFDM0I7O0VBRUQsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFOztJQUUzQixPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7R0FDakM7O0VBRUQsU0FBUyxlQUFlLENBQUMsSUFBSSxFQUFFO0lBQzdCLE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBQztJQUM5QyxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFDOztJQUVwQyxPQUFPO01BQ0wsSUFBSSxFQUFFLElBQUk7TUFDVixJQUFJLEVBQUUsSUFBSTtNQUNWLElBQUksRUFBRSxrQkFBa0I7TUFDeEIsUUFBUSxFQUFFLFFBQVE7S0FDbkI7R0FDRjs7RUFFRCxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7O0lBRTNCLElBQUksQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUTtNQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDOztJQUVsRCxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFDOzs7SUFHakUsSUFBSSxDQUFDLFlBQVk7TUFDZixPQUFPLENBQUMsT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLE1BQU0sR0FBRyxNQUFNOztJQUV2RCxPQUFPLFlBQVksQ0FBQyxDQUFDLENBQUM7R0FDdkI7O0VBRUQsU0FBUyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUU7SUFDbEMsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO01BQ3ZDLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFDO0tBQ3hCOztJQUVELE1BQU0sQ0FBQyxTQUFTLEdBQUcsR0FBRTtHQUN0Qjs7RUFFRCxNQUFNLE9BQU8sR0FBRyxTQUFTLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO0lBQzdDLElBQUk7TUFDRixNQUFNLFFBQVEsR0FBRyxlQUFlLENBQUMsSUFBSSxFQUFDO01BQ3RDLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxLQUFJO01BQzlCLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxTQUFROzs7TUFLbEMsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDO1FBQ25CLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU07VUFDMUIsT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQzs7VUFFekMsT0FBTyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7O01BRXJELE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRztRQUNsQixRQUFRLEVBQUUsUUFBUTtRQUNsQixRQUFRLEVBQUUsUUFBUTtRQUNsQixNQUFNLEVBQUUsS0FBSztRQUNiLFNBQVMsRUFBRSxDQUFDLFFBQVEsQ0FBQztRQUN0Qjs7Ozs7TUFLRCxNQUFNLE1BQU0sR0FBRyxVQUFVLEdBQUcsU0FBUTtNQUNwQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksR0FBRTtNQUM3QixPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFNBQVMsR0FBRyxFQUFFLFVBQVUsQ0FBQztRQUNqRSxJQUFJLEdBQUc7VUFDTCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFDO2FBQ2hDOztVQUdILElBQUksQ0FBQyxVQUFVLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUTtZQUMvQyxNQUFNLElBQUksS0FBSyxDQUFDLHdFQUF3RSxDQUFDOztVQUUzRixJQUFJLE9BQU8sVUFBVSxDQUFDLElBQUksS0FBSyxRQUFRO1lBQ3JDLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUM7O1VBRXJFLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUM7VUFDaEMsSUFBSSxDQUFDLE1BQU07WUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDOzs7VUFHL0MsSUFBSSxNQUFNLENBQUMsTUFBTTtZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxHQUFHLFVBQVUsQ0FBQyxJQUFJLEdBQUcsbUJBQW1CLENBQUM7O1VBRXhFLE1BQU0sQ0FBQyxNQUFNLEdBQUcsV0FBVTtVQUMxQixNQUFNLENBQUMsTUFBTSxHQUFHLEtBQUk7O1VBRXBCLGtCQUFrQixDQUFDLE1BQU0sRUFBQztTQUMzQjtPQUNGLEVBQUM7Ozs7S0FJSCxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsQ0FBQztLQUNyRTtHQUNGOzs7RUNqR0QsTUFBTSxVQUFVLEdBQUcsR0FBRTtFQUNyQixTQUFTLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQ3pCLElBQUksRUFBRSxJQUFJLFlBQVksS0FBSyxDQUFDO01BQzFCLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQzs7SUFFOUIsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRO01BQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxHQUFHLG9CQUFvQixDQUFDOzs7SUFHcEUsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDO01BQ2xCLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQzs7SUFFekIsSUFBSSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsSUFBSSxFQUFDO0lBQ25DLE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsYUFBYSxFQUFFO01BQzFDLElBQUk7O1FBSUYsSUFBSSxPQUFPLGFBQWEsS0FBSyxRQUFRO1VBQ25DLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELENBQUM7OztRQUduRUEsWUFBb0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxFQUFDOzs7UUFHOUNDLGFBQXFCLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFDO1FBQzNELFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLGFBQWEsQ0FBQyxLQUFJOzs7UUFHekMsU0FBUyxHQUFHLGVBQWUsQ0FBQyxTQUFTLEVBQUM7OztRQUd0QyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsR0FBR0MsaUJBQXlCLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUSxFQUFDOztRQUVoRyxTQUFTLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFJO1FBQzdCLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBQzs7O1FBR25DLElBQUksU0FBUyxDQUFDLFNBQVM7VUFDckIsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFTOztPQUV6QyxDQUFDLE9BQU8sR0FBRyxFQUFFO1FBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxHQUFHLG9CQUFvQixHQUFHLEdBQUcsQ0FBQztPQUNwRTtLQUNGLEVBQUM7O0lBRUYsT0FBTyxTQUFTO0dBQ2pCOztFQUVELFNBQVMsU0FBUyxDQUFDLElBQUksRUFBRTtJQUN2QixNQUFNLFNBQVMsR0FBRyxJQUFJLG9CQUFvQixDQUFDLElBQUksRUFBQztJQUNoREQsYUFBcUIsQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBQzs7O0lBR25ERCxZQUFvQixDQUFDLFNBQVMsRUFBRSxnQkFBZ0IsRUFBQzs7O0lBR2pELE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFDO0lBQ2xEQSxZQUFvQixDQUFDLGFBQWEsRUFBRSxhQUFhLEVBQUM7SUFDbEQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFDO0lBQzFILFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLEtBQUk7O0lBRTNCLE9BQU8sU0FBUztHQUNqQjs7RUFFRCxTQUFTLG9CQUFvQixDQUFDLElBQUksRUFBRTs7SUFFbEMsT0FBTyxXQUFXOztNQUVoQixJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUM7UUFDbEIsT0FBTyxVQUFVLENBQUMsSUFBSSxDQUFDOztNQUV6QixNQUFNLFNBQVMsR0FBRyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUM7TUFDakMsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsVUFBUzs7TUFFakMsT0FBTyxTQUFTO0tBQ2pCO0dBQ0Y7OztBQUdEQyxlQUFxQixDQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7QUFDM0NBLGVBQXFCLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUM7OztFQUdqRCxRQUFRLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQzs7OzsifQ==
