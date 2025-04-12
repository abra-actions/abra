import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'], 
  target: 'node18',
  outDir: 'dist',
  bundle: true,
  clean: true,
  platform: 'node',
  noExternal: ['typescript']
});

