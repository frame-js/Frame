'use strict'

import ObjectModel from './ObjectModel'

// Protect Blueprint using a schema
const BlueprintSchema = new ObjectModel({
  name: ObjectModel.StringNotBlank,

  // Blueprint provides
  init: [Function],
  in: [Function],
  on: [Function],
  describe: [Object],

  // Internals
  out: Function,
  error: Function,
  close: [Function],

  // User facing
  to: Function,
  from: Function,

  value: Function,
})

export default BlueprintSchema
