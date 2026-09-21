import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shim = (file: string) => path.resolve(__dirname, 'web', file);

// Browser-only build. The desktop app talks to SQLite, the file system and
// native dialogs through Tauri; this config swaps those modules for the
// in-memory stand-ins under web/ so the takeoff tools run in a plain browser.
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: [
        { find: /^(\.{1,2}\/)+utils\/storage$/, replacement: shim('storage.web.ts') },
        { find: /^(\.{1,2}\/)+utils\/pdfCache$/, replacement: shim('pdfCache.web.ts') },
        { find: /^@tauri-apps\/api\/core$/, replacement: shim('tauri-core.web.ts') },
        { find: /^@tauri-apps\/api\/event$/, replacement: shim('tauri-event.web.ts') },
        { find: /^@tauri-apps\/plugin-dialog$/, replacement: shim('tauri-dialog.web.ts') },
        { find: /^@tauri-apps\/plugin-fs$/, replacement: shim('tauri-fs.web.ts') },
        { find: /^@tauri-apps\/plugin-store$/, replacement: shim('tauri-store.web.ts') },
      ],
    },
    build: {
      outDir: 'dist-web',
    },
  })
);
