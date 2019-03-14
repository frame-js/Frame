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

  pipes: [],
  events: [],
  flow: [],
}

export default BlueprintBase
