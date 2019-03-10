'use strict'

// Object helper functions
function assignObject(target, source) {
  for (let propertyName of Object.getOwnPropertyNames(source)) {
    if (propertyName === 'name')
      continue

    if (typeof source[propertyName] === 'object')
      if (Array.isArray(source[propertyName]))
        target[propertyName] = []
      else
        target[propertyName] = Object.create(source[propertyName])
    else
      Object.defineProperty(
        target,
        propertyName,
        Object.getOwnPropertyDescriptor(source, propertyName)
      )
  }

  return target
}

function setDescriptor(target, value, configurable) {
  Object.defineProperty(target, 'toString', {
    enumerable: false,
    writable: false,
    configurable: true,
    value: function() {
      return (value) ? '[Frame: ' + value + ']' : '[Frame: Constructor]'
    },
  })

  Object.defineProperty(target, 'name', {
    enumerable: false,
    writable: false,
    configurable: (configurable) ? true : false,
    value: value,
  })
}

export {
  assignObject,
  setDescriptor
}
