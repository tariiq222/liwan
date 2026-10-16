import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: [join(here, 'app/assets/css/main.css')],
  // Specific groups first; the group folder is dropped from the name (shared/data/DataTable.vue is SharedDataTable).
  components: [
    ...['layout', 'data', 'form', 'feedback'].map(group => ({
      path: join(here, `app/components/shared/${group}`), prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'],
    })),
    // The shell template keeps its plain names (ShellFrame, ModuleRail).
    { path: join(here, 'app/components/shell'), pathPrefix: false, ignore: ['**/__tests__/**'] },
  ],
  ui: { fonts: false, colorMode: false },
  // Only the layer's own messages: @nuxtjs/i18n merges these files into the app's locales
  // (names, direction and the default locale belong to the app).
  i18n: {
    locales: ['ar', 'en'].map(code => ({ code, files: [`${code}/ui.json`] })),
  },
})
