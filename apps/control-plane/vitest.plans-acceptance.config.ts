import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/plans-acceptance.live.test.ts'],
  },
})
