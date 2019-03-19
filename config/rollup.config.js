import build from './build'
import dev from './dev'
import min from './min'

import bootstrap from './bootstrap'

if (process.env.build === 'production')
  module.exports = [build, min, bootstrap]
else if (process.env.build === 'dev')
  module.exports = dev
