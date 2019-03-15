/* eslint-disable prefer-template */
import log from './logger'
import httpLoader from '../blueprints/loaders/http'
import fileLoader from '../blueprints/loaders/file'

// Multi-environment async module loader
const modules = {
  'loaders/http': httpLoader,
  'loaders/file': fileLoader,
}

function normalizeName(name) {
  // TODO: loop through each file path and normalize it too:
  return name.trim().toLowerCase()//.capitalize()
}

function resolveFileInfo(file) {
  const normalizedFileName = normalizeName(file)
  const protocol = parseProtocol(file)

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

  var protoResults = name.match(/:\/\//gi) && name.split(/:\/\//gi)

  // No protocol found, if browser environment then is relative URL else is a file path. (Sane defaults but can be overridden)
  if (!protoResults)
    return (typeof window === 'object') ? 'http' : 'file'

  return protoResults[0]
}

function runModuleCallbacks(module) {
  for (const callback of module.callbacks) {
    callback(module.module)
  }

  module.callbacks = []
}

const imports = function(name, opts, callback) {
  try {
    const fileInfo = resolveFileInfo(name)
    const fileName = fileInfo.name
    const protocol = fileInfo.protocol

    log('loading module:', fileName)

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
    }

    // Bootstrapping loader blueprints ;)
    //Frame('Loaders/' + protocol).from(fileName).to(fileName, opts, function(err, exportFile) {})

    const loader = 'loaders/' + protocol
    modules[loader].module.init() // TODO: optional init (inside Frame core)
    modules[loader].module.in(fileName, opts, function(err, exportFile){
      if (err)
        log('Error: ', err, fileName)
      else {
        log('Loaded Blueprint module: ', fileName)

        if (!exportFile || typeof exportFile !== 'object')
          throw new Error('Invalid Blueprint file, Blueprint is expected to be an object or class')

        if (typeof exportFile.name !== 'string')
          throw new Error('Invalid Blueprint file, Blueprint missing a name')

        const module = modules[fileName]
        if (!module)
          throw new Error('Uh oh, we shouldnt be here')

        // Module already loaded. Not suppose to be here. Only from force-loading would get you here.
        if (module.loaded)
          throw new Error('Blueprint "' + exportFile.name + '" already loaded.')

        module.module = exportFile
        module.loaded = true

        runModuleCallbacks(module)
      }
    })

    // TODO: modules[loader].module.bundle support for CLI tooling.

  } catch (err) {
    throw new Error('Could not load blueprint \'' + name + '\'\n' + err)
  }
}

export default imports
