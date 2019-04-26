'use strict'

import { BlueprintMethods } from './methods'
import { assignObject, setDescriptor } from './helpers'

function BlueprintStub(target) {
  const blueprint = {}
  assignObject(blueprint, BlueprintMethods)

  blueprint.stub = true
  blueprint.Frame = {
    parents: [],
    describe: [],
  }

  if (typeof target === 'function') {
    setDescriptor(blueprint, 'Function')
    blueprint.in = target
    blueprint.on = target
  } else {
    setDescriptor(blueprint, 'Primitive')
    blueprint.in = function primitiveWrapper() {
      log.debug(this.name + '.in:', target)
      this.out(target)
    }
    blueprint.on = function primitiveWrapper() {
      log.debug(this.name + '.on:', target)
      this.out(target)
    }
  }

  return blueprint
}

export default BlueprintStub
