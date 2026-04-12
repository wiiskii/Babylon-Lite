import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: mode === 'prod' ? 'dist/prod' : 'dist',
    rollupOptions: {
      external: [],
    },
    sourcemap: true,
    minify: mode === 'prod' ? 'esbuild' : false,
  },
  plugins: [],
}));
