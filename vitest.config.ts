import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'commonjs' } })],
  test: {
    globals: true,
    root: './',
  },
})
