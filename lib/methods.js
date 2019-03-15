'use strict'

import log from './logger'
import { destructure, assignObject, setDescriptor } from './helpers'

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

  out: function(index, data) {
    debounce(nextPipe, 1, this, [index, null, data])
  },

  error: function(index, err) {
    debounce(nextPipe, 1, this, [index, err])
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
}

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

  log(direction, '(): ' + this.name)
  this.Frame.pipes.push({ direction: direction, target: target, params: params })

  // Instance of blueprint
  if (target && target.Frame)
    target.Frame.parents.push(this)

  debounce(processFlow, 1, this)
}

function BlueprintStub(target) {
  const blueprint = target
  assignObject(blueprint, BlueprintMethods)

  blueprint.stub = true
  blueprint.Frame = {
    parents: [],
    describe: [],
  }

  if (typeof target === 'function') {
    setDescriptor(blueprint, 'Function')
    blueprint.in = target
    blueprint.on = target
  } else {
    setDescriptor(blueprint, 'Primitive')
    blueprint.in = function primitiveWrapper() {
      return target
    }
    blueprint.on = function primitiveWrapper() {
      this.out(target)
    }
  }

  return blueprint
}

function debounce(func, wait, blueprint, args) {
  let name = func.name
  clearTimeout(blueprint.Frame.debounce[name])
  blueprint.Frame.debounce[name] = setTimeout(function() {
    delete blueprint.Frame.debounce[name]
    func.apply(blueprint, args)
  }, wait)
}

function factory(fn) {
  return function() {
    return fn.apply(this, arguments)
  }
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

  log('Processing flow for ' + this.name)
  log()
  this.Frame.processingFlow = true

  // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
  this.Frame.pipes.unshift({ direction: 'to', target: this })

  // Break out event pipes and flow pipes into separate flows.
  let i = 1 // Start at 1, since our worker blueprint instance should be 0
  for (let pipe of this.Frame.pipes) {
    let blueprint = pipe.target

    if (pipe.direction === 'from') {
      if (typeof blueprint.on !== 'function')
        throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')
      else {
        // .from(Events) start the flow at index 0
        bindPipe.call(this, pipe, 0, this.Frame.events)
      }
    } else if (pipe.direction === 'to') {
      bindPipe.call(this, pipe, i, this.Frame.flow)
      i++
    }
  }

  startFlow.call(this)
}

function bindPipe(pipe, index, list) {
  const out = new factory(pipe.target.out)
  const error = new factory(pipe.target.error)

  pipe.target.out = out.bind(this, index)
  pipe.target.error = error.bind(this, index)
  list.push(pipe)
}

function flowsReady() {
  // if blueprint has not been initialized yet (i.e. constructor not used.)
  if (!this.Frame.initialized) {
    initBlueprint.call(this, processFlow)
    return false
  }

  // Loop through all blueprints in flow to make sure they have been loaded and initialized.
  let flowsReady = true
  for (let pipe of this.Frame.pipes) {
    let target = pipe.target

    // Not a blueprint, either a function or primitive
    if (target.stub)
      continue

    if (!target.Frame.loaded) { // TODO: On load, need to reach out to parent to restart processFlow
      flowsReady = false
      continue
    }

    if (!target.Frame.initialized) {
      initBlueprint.call(target, processFlow.bind(this))
      flowsReady = false
      continue
    }
  }

  return flowsReady
}

function startFlow() {
  log('Starting flow for ' + this.name)

  for (let event of this.Frame.events) {
    let blueprint = event.target
    const props = destructure(blueprint.Frame.describe.on, event.params)
    blueprint.on.call(blueprint, props)
  }
}

function nextPipe(index, err, data) {
  if (err)
    return log.error('TODO: handle error:', err)

  const flow = this.Frame.flow
  const next = flow[index]

  // If we're at the end of the flow
  if (!next || !next.target) {
    this.Frame.processingFlow = false

    if (this.Frame.isPromised) {
      this.Frame.promise.resolve(data)
      this.Frame.isPromised = false
    }

    return log('End of flow')
  }

  const blueprint = next.target
  const props = destructure(blueprint.Frame.describe.in, next.params)
  const retValue = blueprint.in.call(blueprint, data, props, new factory(pipeCallback).bind(blueprint))
  const retType = typeof retValue

  // Blueprint.in does not return anything
  if (retType === 'undefined')
    return

  if (retType === 'object' && retValue instanceof Promise) {
    // Handle promises
    retValue.then(blueprint.out).catch(blueprint.error)
  } else if (retType === 'object' && retValue instanceof Error) {
    // Handle errors
    blueprint.error(retValue)
  } else {
    // Handle regular primitives and objects
    blueprint.out(retValue)
  }
}

function pipeCallback(err, data) {
  if (err)
    return this.error(err)

  return this.out(data)
}

/*
  // If blueprint is part of a flow
  let parents = this.Frame.parents
  if (parents.length >= 1) {
    for (let parent of parents) {
      log('Calling parent')
      parent.Frame.nextPipe.call(parent, err, data)
    }
    return
  }
*/

function initBlueprint(callback) {
  let blueprint = this

  try {
    let props = blueprint.Frame.props ? blueprint.Frame.props : {}

    // If Blueprint foregoes the initializer, stub it.
    if (!blueprint.init)
      blueprint.init = function(_, callback) {
        callback()
      }

    props = destructure(blueprint.Frame.describe.init, props)
    blueprint.init.call(blueprint, props, function(err) {
      if (err)
        return log('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

      // Blueprint intitialzed
      log('Blueprint ' + blueprint.name + ' intialized')

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
