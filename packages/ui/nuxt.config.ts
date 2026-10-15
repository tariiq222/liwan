import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: [join(here, 'app/assets/css/main.css')],
  // Specific groups first; the group folder is dropped from the name (shared/data/DataTable.vue is SharedDataTable).
  components: ['layout', 'data', 'form', 'feedback'].map(group => ({
    path: join(here, `app/components/shared/${group}`), prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'],
  })),
  ui: { fonts: false, colorMode: false },
})
