// Rollup plugins

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
    file: 'build/frame.js',
    format: 'iife',

    exports: 'none',

    sourcemap: 'inline',
    freeze: false,
    preferConst: true,
  },

  plugins: [
  ],
}
