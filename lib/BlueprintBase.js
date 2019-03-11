'use strict'

// Internal Frame props
const BlueprintBase = {
  loaded: false,
  initialized: false,
  processingFlow: false,
  props: {},
  flow: [],
  pipes: [],
  debounce: {},
  name: '',
  describe: ['init', 'in', 'out'],
}

export default BlueprintBase
