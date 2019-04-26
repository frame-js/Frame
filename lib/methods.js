'use strict'

import log from './logger'
import BlueprintStub from './BlueprintStub'
import { processFlow, nextPipe } from './flow'

// Blueprint Methods
const BlueprintMethods = {
  to: function(target) {
    return addPipe.call(this, 'to', target, Array.from(arguments).slice(1))
  },

  from: function(target) {
    return addPipe.call(this, 'from', target, Array.from(arguments).slice(1))
  },

  out: function(index, data) {
    log.debug('Worker ' + this.name + '.out:', data, arguments)
    queue(nextPipe, this, [index, null, data])
  },

  error: function(index, err) {
    log.error('Worker ' + this.name + '.error:', err, arguments)
    queue(nextPipe, this, [index, err])
  },

  get value() {
    // Bail if we're not ready. (Used to get out of ObjectModel and assignObject limbo)
    if (!this.Frame)
      return ''

    const blueprint = this
    const promiseForValue = new Promise(function(resolve, reject) {
      blueprint.Frame.isPromised = true
      blueprint.Frame.promise = { resolve: resolve, reject: reject }
    })
    return promiseForValue
  },

  //catch: function(callback){ ... }
}

// Flow Method helpers
function debounce(func, wait, blueprint, args) {
  const name = func.name
  clearTimeout(blueprint.Frame.debounce[name])
  blueprint.Frame.debounce[name] = setTimeout(function() {
    delete blueprint.Frame.debounce[name]
    func.apply(blueprint, args)
  }, wait)
}

function queue(func, blueprint, args) {
  // Queue array is primarily for IDE.
  let queuePosition = blueprint.Frame.queue.length
  blueprint.Frame.queue.push(setTimeout(function() {
    // TODO: Cleanup queue
    func.apply(blueprint, args)
  }, 1))
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
    target = BlueprintStub(target)
  } else if (typeof target !== 'function') {
    target = BlueprintStub(target)
  }

  // Ensure we're working on a new instance of worker blueprint
  let blueprint = this
  if (!blueprint.Frame.instance) {
    log.debug('Creating new instance for', blueprint.name)
    blueprint = blueprint(Array.from(blueprint.Frame.props)[0])
    blueprint.Frame.state = this.Frame.state // TODO: Should create a new state object?
    blueprint.Frame.instance = true
  }

  log.debug(blueprint.name + '.' + direction + '(): ' + target.name)
  blueprint.Frame.pipes.push({ direction: direction, target: target, params: params })

  debounce(processFlow, 1, blueprint)
  return blueprint
}

export default BlueprintMethods
export { BlueprintMethods, debounce, processFlow }
