'use strict'

// Concept based on: http://objectmodel.js.org/
function ObjectModel(schemaObj) {
  if (typeof schemaObj === 'function') {
    return { type: schemaObj.name, expects: schemaObj }
  } else if (typeof schemaObj !== 'object')
    schemaObj = {}

  // Clone schema object so we don't mutate it.
  let schema = Object.create(schemaObj)
  Object.assign(schema, schemaObj)

  // Loop through Schema object keys
  for (let key of Object.keys(schema)) {
    // Create a schema object with types
    if (typeof schema[key] === 'function')
      schema[key] = { required: true, type: typeof schema[key]() }
    else if (typeof schema[key] === 'object' && Array.isArray(schema[key])) {
      let schemaArr = schema[key]
      schema[key] = { required: false, type: 'optional', types: [] }
      for (let schemaType of schemaArr) {
        if (typeof schemaType === 'function')
          schema[key].types.push(typeof schemaType())
      }
    } else if (typeof schema[key] === 'object' && schema[key].type) {
      schema[key] = { required: true, type: schema[key].type, expects: schema[key].expects }
    } else {
      schema[key] = { required: true, type: typeof schema[key] }
    }
  }

  // Validate schema props
  function isValidSchema(key, value) {
    // TODO: Make more flexible by defining null and undefined types.
    // No schema defined for key
    if (!schema[key])
      return true

    if (schema[key].required && typeof value === schema[key].type) {
      return true
    } else if (!schema[key].required && schema[key].type === 'optional') {
      if (value && !schema[key].types.includes(typeof value))
        return false

      return true
    } else if (schema[key].required && schema[key].type) {
      if (typeof schema[key].expects === 'function') {
        return schema[key].expects(value)
      }
    }

    return false
  }

  // Validate schema (once Schema constructor is called)
  return function validateSchema(objToValidate) {
    let proxyObj = {}
    let obj = objToValidate

    for (let key of Object.getOwnPropertyNames(objToValidate)) {
      const propDescriptor = Object.getOwnPropertyDescriptor(objToValidate, key)

      // Property already protected
      if (!propDescriptor.writable || !propDescriptor.configurable) {
        Object.defineProperty(obj, key, propDescriptor)
        continue
      }

      // Schema does not exist for prop, passthrough
      if (!schema[key]) {
        Object.defineProperty(obj, key, propDescriptor)
        continue
      }

      proxyObj[key] = objToValidate[key]
      Object.defineProperty(obj, key, {
        enumerable: propDescriptor.enumerable,
        configurable: propDescriptor.configurable,
        get: function() {
          return proxyObj[key]
        },

        set: function(value) {
          if (!isValidSchema(key, value)) {
            if (schema[key].expects) {
              value = (typeof value === 'string') ? value : typeof value
              throw new Error('Expecting "' + key + '" to be "' + schema[key].type + '", got "' + value + '"')
            } else if (schema[key].type === 'optional') {
              throw new Error('Expecting "' + key + '" to be one of "' + schema[key].types + '", got "' + typeof value + '"')
            } else
              throw new Error('Expecting "' + key + '" to be a "' + schema[key].type + '", got "' + typeof value + '"')
          }

          proxyObj[key] = value
          return value
        },
      })

      obj[key] = objToValidate[key]
    }

    return obj
  }
}

ObjectModel.StringNotBlank = ObjectModel(function StringNotBlank(str) {
  if (typeof str !== 'string')
    return false

  return str.trim().length > 0
})

export default ObjectModel
