import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// build 时注入版本号与 git commit，便于确认线上对应哪个版本
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
).version
const gitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
})()

// web 直接消费 core 源码（dev/build 都用），无需 core 先打包。
// core 的 tsup 产物留给浏览器扩展复用。
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __GIT_HASH__: JSON.stringify(gitHash),
  },
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
