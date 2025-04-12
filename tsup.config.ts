import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  bundle: true,
  clean: true,
  platform: 'node',
  noExternal: ['typescript']
});

