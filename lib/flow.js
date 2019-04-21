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

  log.debug('Processing flow for ' + this.name)
  log.debug()
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

      // Used when target blueprint is part of another flow
      if (blueprint && blueprint.Frame)
        blueprint.Frame.parents.push({ target: this }) // TODO: Check if worker blueprint is already added.

      // .from(Events) start the flow at index 0
      pipe.context = createContext(this, pipe.target, 0)
      this.Frame.events.push(pipe)

    } else if (pipe.direction === 'to') {
      if (typeof blueprint.in !== 'function')
        throw new Error('Blueprint \'' + blueprint.name + '\' does not support input.')

      pipe.context = createContext(this, pipe.target, i)
      this.Frame.flow.push(pipe)
      i++
    }
  }

  startFlow.call(this)
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
  log.debug('Starting flow for ' + this.name)

  for (const event of this.Frame.events) {
    const blueprint = event.target
    const props = destructure(blueprint.Frame.describe.on, event.params)
    log.debug(blueprint.name, 'props', props)

    // If not already processing flow.
    if (blueprint.Frame.pipes && blueprint.Frame.pipes.length > 0)
      log.debug(this.name + ' is not starting ' + blueprint.name + ', waiting for it to finish')
    else if (!blueprint.Frame.processingFlow)
      blueprint.on.call(event.context, props)
  }
}

function initBlueprint(callback) {
  const blueprint = this

  try {
    let props = blueprint.Frame.props ? blueprint.Frame.props : {}

    // If Blueprint foregoes the initializer, stub it.
    if (!blueprint.init)
      blueprint.init = function(_, done) {
        done()
      }

    props = destructure(blueprint.Frame.describe.init, props)
    blueprint.init.call(blueprint, props, function(err) {
      if (err)
        return log.error('Error initializing blueprint \'' + blueprint.name + '\'\n' + err)

      // Blueprint intitialzed
      log.debug('Blueprint ' + blueprint.name + ' intialized')

      blueprint.Frame.props = {}
      blueprint.Frame.initialized = true
      blueprint.Frame.initializing = false
      setTimeout(function() { callback && callback.call(blueprint) }, 1)
    })

  } catch (err) {
    throw new Error('Blueprint \'' + blueprint.name + '\' could not initialize.\n' + err)
  }
}

export { processFlow }
