import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// The prototype reads the repository's real contracts, score package and static brain from ../../src.
// It never writes there, and nothing in ../../src imports the prototype.
export default defineConfig(({ mode }) => ({
  base: './',
  resolve: { alias: { '@encore': fileURLToPath(new URL('../../src', import.meta.url)) } },
  server: { fs: { allow: ['../..'] } },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1200 },
}));
