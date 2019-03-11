'use strict'

import log from './logger'

// Blueprint Methods
const BlueprintMethods = {
  to: function(target) {
    addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
    return this
  },

  from: function(target) {
    addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
    return this
  },

  out: function(err, data) {
    if (err)
      return log.error('Error:', err)

    log('out data:', data)
    // TODO: this.next() but needs to be aware that an event can happen multiple times before other flows finish..
    // TODO: determine what happens when a Blueprint self modifies.. like in: function() { this.to( function(){} )}
  },

  error: function(err) {
    return log.error('Error:', err)
  },

  /*get value() {
    this.Frame.isPromised = true
    this.Frame.promise = new Promise()
    return this.Frame.promise
  },*/
}

function addPipe(direction, target, params) {
  if (!this)
    throw new Error('Blueprint method called without class, did you assign it to a variable?')

  if (!this.Frame || !this.Frame.pipes)
    throw new Error('Not working with a valid Blueprint object')

  if (typeof target !== 'function')
    throw new Error(this.Frame.name + '.to() was called with improper parameters')

  log(direction, '(): ' + this.name)
  this.Frame.pipes.push({ direction: direction, target: target, params: params })
  debounce(processFlow, 1, this)
}

function debounce(func, wait, blueprint) {
  let name = func.name
  clearTimeout(blueprint.Frame.debounce[name])
  blueprint.Frame.debounce[name] = setTimeout(function() {
    delete blueprint.Frame.debounce[name]
    func.call(blueprint)
  }, wait)
}

function processFlow() {
  // Already processing this Blueprint's flow.
  if (this.Frame.processingFlow)
    return

  // If no pipes for flow, then nothing to do.
  if (this.Frame.pipes.length < 1)
    return

  // if blueprint has not been initialized yet (i.e. constructor not used.)
  if (!this.Frame.initialized)
    return initBlueprint.call(this, processFlow)

  // TODO: loop through all blueprints in flow to make sure they have loaded and been initialized.

  this.Frame.processingFlow = true
  log('Processing flow for ' + this.name)
}

function initBlueprint(callback) {
  let blueprint = this

  try {
    const props = blueprint.Frame.props ? blueprint.Frame.props : {}

    // If Blueprint foregoes the initializer, stub it.
    if (!blueprint.init)
      blueprint.init = function(props, callback) { callback() }

    blueprint.init.call(blueprint, props, function() {
      // Blueprint intitialzed
      log('Blueprint intialized')

      blueprint.Frame.props = {}
      blueprint.Frame.initialized = true
      callback && callback.call(blueprint)
    })

  } catch (err) {
    throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
  }
}

export default BlueprintMethods
export { BlueprintMethods, debounce, processFlow }
