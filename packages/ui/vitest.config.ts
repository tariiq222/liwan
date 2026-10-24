import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // renderShared compiles the .vue file and its imports with @vue/compiler-sfc and
    // TypeScript on every render, so the 5s default only holds on an idle machine
    // running one worker. A cold first render is ~40 ms of CPU per component in the
    // import tree; this budget covers that work, not a slow assertion.
    testTimeout: 30_000,
  },
})
