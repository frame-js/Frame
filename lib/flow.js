'use strict'

import log from './logger'
import { destructure } from './helpers'

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
  for (const pipe of this.Frame.pipes) {
    const blueprint = pipe.target

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
  for (const pipe of this.Frame.pipes) {
    const target = pipe.target

    // Not a blueprint, either a function or primitive
    if (target.stub)
      continue

    if (!target.Frame.loaded) {
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

  for (const event of this.Frame.events) {
    const blueprint = event.target
    const props = destructure(blueprint.Frame.describe.on, event.params)

    // If not already processing flow.
    if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
      console.log('Not starting ' + blueprint.name + ', waiting for it to finish')
    else if (!blueprint.Frame.processingFlow)
      blueprint.on.call(blueprint, props)
  }
}

function initBlueprint(callback) {
  const blueprint = this

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

function factory(fn) {
  return function() {
    return fn.apply(this, arguments)
  }
}

export { processFlow }
