import {resolve} from 'node:path'
import {defineConfig, externalizeDepsPlugin} from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const sharedAlias = {'@shared': resolve('src/shared')}
const mainAlias = {...sharedAlias, '@main': resolve('src/main')}
const rendererAlias = {...sharedAlias, '@renderer': resolve('src/renderer/src')}
// Reduced from ElecKoi's Electron Vite configuration (AGPL-3.0).
export default defineConfig({
 main: {
  resolve: {alias: mainAlias},
  plugins: [externalizeDepsPlugin()],
  build: {
   lib: {
    entry: {
     main: resolve('src/main/main.ts'),
     'asr-worker': resolve('src/main/workers/asr-worker.ts'),
     'knowledge-worker': resolve('src/main/workers/knowledge-worker.ts'),
     'media-download-worker': resolve('src/main/workers/media-download-worker.ts'),
     'research-worker': resolve('src/main/workers/research-worker.ts'),
     'media-process-guardian': resolve('src/main/workers/media-process-guardian.ts'),
     'im-weixin-local-worker': resolve('src/main/workers/im-weixin-local-worker.ts')
    }
   }
  }
 },
 preload: {
  resolve: {alias: sharedAlias},
  plugins: [externalizeDepsPlugin()],
  build: {
   lib: {entry: resolve('src/preload/preload.ts')},
   rollupOptions: {output: {format: 'cjs', entryFileNames: '[name].cjs'}}
  }
 },
 renderer: {plugins: [react(), tailwindcss()], resolve: {alias: rendererAlias}}
})
