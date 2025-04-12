// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],                
  bundle: true,                   
  noExternal: ['typescript'],     
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  clean: true
});
