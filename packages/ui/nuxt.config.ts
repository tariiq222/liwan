import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: [join(here, 'app/assets/css/main.css')],
  ui: { fonts: false, colorMode: false },
})
