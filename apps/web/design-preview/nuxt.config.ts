import { fileURLToPath } from 'node:url'

// Standalone reference. Never extends the authenticated application's config.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui', '@nuxtjs/i18n'],
  css: ['~/assets/theme.css'],
  devtools: { enabled: false },
  ui: { fonts: false, colorMode: false },
  icon: { provider: 'none', fallbackToApi: false, clientBundle: { scan: true } },
  alias: {
    '#nasq-utils': fileURLToPath(new URL('../app/utils', import.meta.url)),
    '#nasq-composables': fileURLToPath(new URL('../app/composables', import.meta.url)),
  },
  nitro: { publicAssets: [{ dir: fileURLToPath(new URL('../public/fonts', import.meta.url)), baseURL: '/fonts' }] },
  app: { head: { title: 'نسق — مرجع الواجهات', meta: [{ name: 'robots', content: 'noindex, nofollow' }] } },
  i18n: {
    defaultLocale: 'ar', strategy: 'no_prefix', detectBrowserLanguage: false,
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', file: 'ar.json' },
      { code: 'en', language: 'en-US', dir: 'ltr', file: 'en.json' },
    ],
  },
  typescript: { strict: true },
})
