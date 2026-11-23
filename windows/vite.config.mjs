import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  optimizeDeps: { entries: ['index.html'] },
  server: { watch: { ignored: ['**/test-artifacts/**', '**/release/**'] } }
});
