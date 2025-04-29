import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: [], 
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    platform: 'node',
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['fs', 'path', 'typescript'],
    banner: {
      js: '#!/usr/bin/env node'
    }
  }
]);
