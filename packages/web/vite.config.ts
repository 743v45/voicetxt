import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// web 直接消费 core 源码（dev/build 都用），无需 core 先打包。
// core 的 tsup 产物留给浏览器扩展复用。
export default defineConfig({
  plugins: [react()],
  // 相对 base：适配 GitHub Pages 子路径与 Cloudflare Pages 根域
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@voicetxt/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  // core 源码即时编译；transformers.js 自管 WASM，交给运行时
  optimizeDeps: {
    exclude: ['@voicetxt/core'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
