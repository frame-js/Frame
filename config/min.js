// Rollup plugins
import cleanup from 'rollup-plugin-cleanup'
import strip from 'rollup-plugin-strip'
import { terser } from 'rollup-plugin-terser'
import filesize from 'rollup-plugin-filesize'
import gzipPlugin from 'rollup-plugin-gzip'

function onwarn(warning) {
  if (warning.code !== 'CIRCULAR_DEPENDENCY') {
    // eslint-disable-next-line no-console
    console.error(`(!) ${warning.message}`)
  }
}

export default {
  onwarn,
  input: 'lib/index.js',
  output: {
    file: 'build/frame.min.js',
    format: 'iife',

    exports: 'none',

    sourcemap: false,
    freeze: false,
    preferConst: true,
  },

  plugins: [
    cleanup(),
    strip({
      functions: ['log.debug'],
    }),
    terser(),
    filesize({ showMinifiedSize: false }),
    gzipPlugin(),
  ],
}
