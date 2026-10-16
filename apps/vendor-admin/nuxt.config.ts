import { fileURLToPath } from 'node:url'
import { discoverLocaleFiles } from './i18n/localeFiles'

const localeFiles = discoverLocaleFiles(fileURLToPath(new URL('./i18n/locales', import.meta.url)))

export default defineNuxtConfig({
  // The second layer (@nasq/commercial-ui) is added when the billing-presentation move lands.
  extends: ['@nasq/ui'],
  compatibilityDate: '2025-07-15',
  hooks: {
    ready(nuxt) {
      // Vue includes serverPrefetch registration in its useId boundary tree.
      // Removing these registrations only on the client breaks field/menu IDs.
      const client = nuxt.options.optimization.treeShake.composables.client
      client.vue = (client.vue ?? []).filter(name => name !== 'onServerPrefetch')
    },
  },
  devtools: { enabled: false },
  devServer: { port: 3100 },
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/i18n'],
  icon: {
    provider: 'none',
    fallbackToApi: false,
    clientBundle: {
      scan: {
        // Keep Nuxt Icon's default source patterns and include composable
        // TypeScript where dynamic UIcon names are declared.
        globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', 'app/composables/**/*.ts', 'app/utils/**/*.ts'],
      },
    },
  },
  components: [{ path: '~/components', ignore: ['**/__tests__/**'] }],
  app: {
    head: {
      title: 'nasq',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  i18n: {
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', files: localeFiles.ar },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: localeFiles.en },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },
  // Private BFF settings (NUXT_CONTROL_URL, NUXT_SERVICE_KEY, NUXT_INSTALLATION_ID,
  // NUXT_ADMIN_ORIGIN, NUXT_TRUST_PROXY). Nothing here is public.
  runtimeConfig: {
    controlUrl: '',
    serviceKey: '',
    installationId: '',
    adminOrigin: '',
    trustProxy: false,
  },
  routeRules: {
    '/**': {
      headers: {
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    },
    '/api/**': { headers: { 'Cache-Control': 'no-store' } },
  },
  vite: {
    define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: process.env.NASQ_HYDRATION_DEBUG === '1' },
  },
  typescript: { strict: true },
})
