'use strict'

const FlowSchema = {
  direction: '', // to or from
  target: null,
  params: [],
  context: {
    name: '',
    state: {},
    out: function(){},
    error: function(){},
  }
}

// Internal Frame props
const BlueprintBase = {
  name: '',
  describe: ['init', 'in', 'out'], // TODO: Change to object and make separate schema. { init: { name: '', description: ' } }
  props: {},
  state: {},

  loaded: false,
  initialized: false,
  processingFlow: false,
  instance: false,

  debounce: {},
  queue: [],
  parents: [],

  pipes: [], //[FlowSchema],
  events: [], //[FlowSchema],
  flow: [], //[FlowSchema],

  isPromised: false,
  promise: {},
}

export default BlueprintBase
