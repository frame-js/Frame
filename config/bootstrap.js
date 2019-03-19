// Rollup plugins
import strip from 'rollup-plugin-strip'

function onwarn(warning) {
  if (warning.code !== 'CIRCULAR_DEPENDENCY') {
    // eslint-disable-next-line no-console
    console.error(`(!) ${warning.message}`)
  }
}

export default {
  onwarn,
  input: 'lib/bootstrap.js',
  output: {
    file: 'build/frame.bootstrap.js',
    format: 'iife',

    exports: 'none',

    sourcemap: 'inline',
    freeze: false,
    preferConst: true,
  },

  plugins: [
    //eslint('config/dev.eslintrc.js'),
    strip({
      functions: ['log.debug'],
    }),
  ],
}
