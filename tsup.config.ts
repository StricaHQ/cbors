import { defineConfig } from 'tsup';

// target es2019: no ??/?. in shipped files, webpack 4 era parsers still work
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    target: 'es2019',
    platform: 'node',
    dts: true,
    splitting: false,
  },
  // self-contained stream implementation for browser bundlers, wired up via
  // the package.json browser field
  {
    entry: { stream: 'shims/stream.cjs' },
    format: ['cjs'],
    target: 'es2019',
    platform: 'browser',
    noExternal: [/.*/],
    esbuildOptions(options) {
      options.define = { ...options.define, global: 'globalThis' };
    },
  },
  // standalone browser bundle, exposed as the `cbors` global
  {
    entry: { index: 'src/index.ts' },
    format: ['iife'],
    globalName: 'cbors',
    target: 'es2019',
    platform: 'browser',
    minify: true,
    noExternal: [/.*/],
    outExtension: () => ({ js: '.min.js' }),
    esbuildOptions(options) {
      options.alias = { stream: 'readable-stream' };
      options.define = { ...options.define, global: 'globalThis' };
    },
  },
]);
