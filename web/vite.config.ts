import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './', // relative asset paths: works on GitHub Pages and any static host
  server: { fs: { allow: ['..'] } }, // slang.json lives one level up, shared with the Go CLI
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
