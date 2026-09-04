import tailwindcss from '@tailwindcss/vite'

const odoo = process.env.NUXT_ODOO_URL ?? 'http://localhost:8069'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['shadcn-nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: {
    head: {
      title: 'nasq',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  i18n: {
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', file: 'ar.json' },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', file: 'en.json' },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    lazy: true,
    detectBrowserLanguage: false,
  },
  nitro: {
    devProxy: {
      '/websocket': { target: 'ws://localhost:8069/websocket', ws: true, changeOrigin: false },
    },
  },
  runtimeConfig: {
    odooUrl: odoo,
    odooDb: process.env.NUXT_ODOO_DB ?? 'odoo19',
  },
  // Browser-only paths, dev convenience: in production Caddy routes them to Odoo. SSR
  // fetches to /api/v1/** go through server/routes/api/v1/[...path].ts, which reads
  // odooUrl at runtime.
  routeRules: {
    '/web/**': { proxy: `${odoo}/web/**` },
    '/odoo/**': { proxy: `${odoo}/odoo/**` },
  },
  typescript: { strict: true },
})
