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
    // One file per pillar namespace, merged by @nuxtjs/i18n into a single
    // message object per locale — key paths are unchanged ($t('tasks.state.done')
    // still resolves). A pillar owns its own namespace file: the HR pillar adds
    // i18n/locales/{ar,en}/hr.json and one entry per locale here, and never
    // touches common.json or tasks.json.
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', files: ['ar/common.json', 'ar/tasks.json', 'ar/projects.json'] },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: ['en/common.json', 'en/tasks.json', 'en/projects.json'] },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
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
    public: {
      // Dev: the Nitro dev proxy above does not upgrade websockets, so
      // useBus() connects directly to Odoo's :8069 in dev. Prod: left empty
      // so useBus() falls back to same-origin (Caddy routes /websocket through).
      // `process.dev` is a runtime (app-code) global, not available while
      // nuxt.config.ts itself is evaluated - NODE_ENV is what `nuxt dev` sets here.
      wsUrl: process.env.NUXT_PUBLIC_WS_URL ?? (process.env.NODE_ENV !== 'production' ? 'ws://localhost:8069/websocket' : ''),
    },
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
