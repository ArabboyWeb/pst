import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'cli': 'src/bin.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'node',
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: false,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: {
      'index': 'src/index.ts',
      'plugin-api': 'src/plugin-api/index.ts',
    },
    format: ['esm'],
    target: 'es2022',
    platform: 'node',
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    shims: true,
  },
]);
