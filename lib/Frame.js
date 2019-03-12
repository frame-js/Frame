'use strict'

import log from './logger'
import exporter from './exports'
import * as helpers from './helpers'
import BlueprintMethods from './methods'
import { debounce, processFlow } from './methods'
import BlueprintBase from './BlueprintBase'
import BlueprintSchema from './schema'
import imports from './loader'

// Frame and Blueprint constructors
const singletons = {}
function Frame(name, opts) {
  if (!(this instanceof Frame))
    return new Frame(name, opts)

  if (typeof name !== 'string')
    throw new Error('Blueprint name \'' + name + '\' is not valid.\n')

  // If blueprint is a singleton (for shared resources), return it instead of creating new instance.
  if (singletons[name])
    return singletons[name]

  let blueprint = new Blueprint(name)
  imports(name, opts, function(blueprintFile) {
    try {

      log('Blueprint loaded:', blueprintFile.name)

      if (typeof blueprintFile !== 'object')
        throw new Error('Blueprint is expected to be an object or class')

      // Update faux blueprint stub with real module
      helpers.assignObject(blueprint, blueprintFile)

      // Update blueprint name
      helpers.setDescriptor(blueprint, blueprintFile.name, false)
      blueprint.Frame.name = blueprintFile.name

      // Apply a schema to blueprint
      blueprint = BlueprintSchema(blueprint)

      // TODO: If blueprint is a loader, then apply a different set of schema rules
      //if (blueprint.protocol === 'loader')
      //  blueprint = BlueprintLoaderSchema(blueprint)

      // Validate Blueprint input with optional sanitizers (using describe syntax)
      blueprint.Frame.describe = helpers.createSanitizers(blueprint.describe, BlueprintBase.describe)

      blueprint.Frame.loaded = true
      debounce(processFlow, 1, blueprint)

      // If blueprint intends to be a singleton, add it to the list.
      if (blueprint.singleton)
        singletons[blueprint.name] = blueprint

    } catch (err) {
      throw new Error('Blueprint \'' + name + '\' is not valid.\n' + err)
    }
  })

  return blueprint
}

function Blueprint(name) {
  let blueprint = new BlueprintConstructor(name)
  helpers.setDescriptor(blueprint, 'Blueprint', true)

  // Blueprint methods
  helpers.assignObject(blueprint, BlueprintMethods)

  // Create hidden blueprint.Frame property to keep state
  let blueprintBase = Object.create(BlueprintBase)
  helpers.assignObject(blueprintBase, BlueprintBase)
  Object.defineProperty(blueprint, 'Frame', { value: blueprintBase, enumerable: true, configurable: true, writable: false }) // TODO: configurable: false, enumerable: false
  blueprint.Frame.name = name

  return blueprint
}

function BlueprintConstructor(name) {
  // Create blueprint from constructor
  return function() {
    let blueprint = new Frame(name)
    blueprint.Frame.props = arguments

    return blueprint
  }
}

// Give Frame an easy descriptor
helpers.setDescriptor(Frame, 'Constructor')
helpers.setDescriptor(Frame.constructor, 'Frame')

// Export Frame globally
exporter('Frame', Frame)
export default Frame
