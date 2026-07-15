import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  target: 'es2022',
  // transformers.js 内部管理自己的 WASM/worker，保持 external，不打包
  external: ['@huggingface/transformers'],
})
