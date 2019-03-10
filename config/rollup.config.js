import build from './build'
import dev from './dev'
import min from './min'

if (process.env.build === 'production')
  module.exports = [build, min]
else if (process.env.build === 'dev')
  module.exports = dev
