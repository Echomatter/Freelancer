import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readmeHelp } from './shared/readme-help.mjs';

const readmePath = fileURLToPath(new URL('./README.md', import.meta.url));
export default defineConfig({
  plugins: [react(), {
    name: 'readme-help',
    enforce: 'pre',
    async load(id) {
      if (id !== `${normalizePath(readmePath)}?help`) return;
      this.addWatchFile(readmePath);
      // A broken documentation hook fails the build instead of the user's UI.
      const excerpts = readmeHelp(await readFile(readmePath, 'utf8'));
      return `export default ${JSON.stringify(excerpts)};`;
    },
  }],
  server: { host: '127.0.0.1', watch: { ignored: ['**/backend/.state/**'] }, proxy: { '/api': 'http://127.0.0.1:47840' } },
  // The source-run server can still have open tabs using the previous build.
  // Keep hashed chunks available for their later lazy imports.
  build: {
    target: 'es2022', emptyOutDir: false,
    rollupOptions: { output: {
      // Cache framework/rendering dependencies independently of application
      // changes and keep the main application chunk below Vite's size warning.
      manualChunks(id) {
        if (!id.includes('/node_modules/')) return;
        if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
        return 'vendor';
      },
    } },
  },
});
