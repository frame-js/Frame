'use strict'

import log from './logger'
import { destructure } from './helpers'

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

  /*get value() {
    this.Frame.isPromised = true
    this.Frame.promise = new Promise()
    return this.Frame.promise
  },*/
}

function addPipe(direction, target, params) {
  if (!this)
    throw new Error('Blueprint method called without instance, did you assign the method to a variable?')

  if (!this.Frame || !this.Frame.pipes)
    throw new Error('Not working with a valid Blueprint object')

  if (typeof target !== 'function' || typeof target.to !== 'function')
    throw new Error(this.Frame.name + '.' + direction + '() was called with improper parameters')

  log(direction, '(): ' + this.name)
  this.Frame.pipes.push({ direction: direction, target: target, params: params })

  // Instance of blueprint
  if (target && target.Frame)
    target.Frame.parents.push(this)

  debounce(processFlow, 1, this)
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
  return function() { return fn.apply(this, arguments) }
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
  console.log()
  this.Frame.processingFlow = true

  // Put this blueprint at the beginning of the flow, that way any .from events trigger the top level first.
  this.Frame.pipes.unshift({ direction: 'to', target: this, params: null })

  // Break out event pipes and flow pipes into separate flows.
  let i = 1 // Start at 1, since our main blueprint instance should be 0
  for (let pipe of this.Frame.pipes) {
    let blueprint = pipe.target
    let out = new factory(pipe.target.out)

    if (pipe.direction === 'from') {
      if (typeof blueprint.on !== 'function')
        throw new Error('Blueprint \'' + blueprint.name + '\' does not support events.')
      else {
        // .from(Events) start the flow at index 0
        pipe.target.out = out.bind(this, 0)
        this.Frame.events.push(pipe)
      }
    } else if (pipe.direction === 'to') {
      pipe.target.out = out.bind(this, i)
      this.Frame.flow.push(pipe)
      i++
    }
  }

  startFlow.call(this)
}

function flowsReady() {
  // if blueprint has not been initialized yet (i.e. constructor not used.)
  if (!this.Frame.initialized) {
    initBlueprint.call(this, processFlow)
    return false
  }

  // Loop through all blueprints in flow to make sure they have been loaded and initialized.
  this.Frame.flowsReady = true
  for (let pipe of this.Frame.pipes) {
    let target = pipe.target
    if (!target.Frame.loaded) { // TODO: On load, need to reach out to parent to restart processFlow
      this.Frame.flowsReady = false
      continue
    }

    if (!target.Frame.initialized) {
      initBlueprint.call(target, processFlow.bind(this))
      this.Frame.flowsReady = false
      continue
    }
  }

  if (!this.Frame.flowsReady)
    return false

  return true
}

function startFlow() {
  console.log('Starting flow for ' + this.name)

  for (let event of this.Frame.events) {
    let blueprint = event.target
    const props = destructure(blueprint.Frame.describe.on, event.params)
    blueprint.on.call(blueprint, props)
  }
}

function nextPipe(index, err, data) {
  /*if (err)
    log.error(this.name, index, 'Error:', err)
  else
    log(this.name, index, 'out data:', data)
  */

  const flow = this.Frame.flow
  const next = flow[index]

  // If we're at the end of the flow
  if (!next || !next.target) {
    this.Frame.processingFlow = false
    return console.log('End of flow')
  }

  const blueprint = next.target
  const props = destructure(blueprint.Frame.describe.in, next.params)
  blueprint.in.call(blueprint, data, props, blueprint.out)
}

/*
  // If blueprint is part of a flow
  let parents = this.Frame.parents
  if (parents.length >= 1) {
    for (let parent of parents) {
      console.log('Calling parent')
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
      blueprint.init = function(props, callback) { callback() }

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
