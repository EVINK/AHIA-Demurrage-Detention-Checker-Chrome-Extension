import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {readFileSync} from 'node:fs';

const {version}=JSON.parse(readFileSync('public/manifest.json','utf8'));

// dist/ also holds packaged releases, so the unpacked extension gets its own folder.
export default defineConfig({
  base: './',
  define: {__APP_VERSION__: JSON.stringify(version)},
  plugins: [vue()],
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {app: 'app.html', worker: 'src/background/worker.ts', 'gmail-autocc': 'src/content/gmail-autocc.ts'},
      output: {entryFileNames: '[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]'}
    }
  }
});
