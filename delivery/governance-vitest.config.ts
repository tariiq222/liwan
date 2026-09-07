import { defineConfig } from 'vitest/config'
export default defineConfig({
  esbuild: { tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext' } }) },
  test: { include: ['apps/web/app/components/project/governance/__tests__/*.test.ts'] },
})
