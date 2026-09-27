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
  build: { target: 'es2022' },
});
