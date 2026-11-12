import { config } from 'zod'

// The page policy forbids eval (server/plugins/content-security-policy.ts). Zod probes `Function('')` to decide
// whether it may compile faster parsers, and the browser reports that probe as a policy violation even though
// Zod catches it. Parsing without compiled parsers skips the probe; the results are the same.
export default defineNuxtPlugin({
  name: 'zod-jitless',
  enforce: 'pre',
  setup() {
    config({ jitless: true })
  },
})
