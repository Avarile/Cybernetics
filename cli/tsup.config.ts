import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cyb: 'src/main.ts' },
  format: ['cjs'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Nest resolves providers by decorator metadata at runtime; minification
  // rewrites class names and breaks that resolution.
  minify: false,
  keepNames: true,
  banner: { js: '#!/usr/bin/env node' },
});
