'use strict'

import ObjectModel from './ObjectModel'

// Protect Blueprint using a schema
const BlueprintSchema = new ObjectModel({
  name: ObjectModel.StringNotBlank,

  // Blueprint provides
  init: [Function],
  in: [Function],
  close: [Function],

  // Internals
  out: Function,
  error: Function,
})

export default BlueprintSchema
