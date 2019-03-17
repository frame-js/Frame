'use strict'

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
}

export default BlueprintBase
