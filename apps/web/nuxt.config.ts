
const odoo = process.env.NUXT_ODOO_URL ?? 'http://localhost:8069'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  hooks: {
    ready(nuxt) {
      // Vue includes serverPrefetch registration in its useId boundary tree.
      // Removing these registrations only on the client breaks field/menu IDs.
      const client = nuxt.options.optimization.treeShake.composables.client
      client.vue = (client.vue ?? []).filter(name => name !== 'onServerPrefetch')
    },
  },
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  ui: { fonts: false, colorMode: false },
  icon: {
    provider: 'none',
    fallbackToApi: false,
    clientBundle: {
      scan: {
        // Keep Nuxt Icon's default source patterns and include composable
        // TypeScript where shared dynamic UIcon names are declared.
        globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', 'app/composables/**/*.ts'],
      },
    },
  },
  // Discover runtime components; specialist chart adapters also use explicit imports.
  components: [{ path: '~/components', ignore: ['**/__tests__/**'] }],
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
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', files: ['ar/common.json', 'ar/tasks.json', 'ar/projects.json', 'ar/settings.json', 'ar/hr.json', 'ar/access.json', 'ar/attachments.json', 'ar/notifications.json', 'ar/taskLifecycle.json', 'ar/chat.json', 'ar/meetings.json'] },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: ['en/common.json', 'en/tasks.json', 'en/projects.json', 'en/settings.json', 'en/hr.json', 'en/access.json', 'en/attachments.json', 'en/notifications.json', 'en/taskLifecycle.json', 'en/chat.json', 'en/meetings.json'] },
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
    // Odoo's public login bootstrap also loads translations outside /web/.
    '/website/translations': { proxy: `${odoo}/website/translations` },
    '/base_setup/**': { proxy: `${odoo}/base_setup/**` },
    '/mail/**': { proxy: `${odoo}/mail/**` },
    '/discuss/**': { proxy: `${odoo}/discuss/**` },
    '/bus/**': { proxy: `${odoo}/bus/**` },
    // Keep Odoo's redirects and login Set-Cookie response in the browser.
    '/web/**': { proxy: { to: `${odoo}/web/**`, fetchOptions: { redirect: 'manual' } } },
    '/odoo/**': { proxy: { to: `${odoo}/odoo/**`, fetchOptions: { redirect: 'manual' } } },
  },
  // Opt-in diagnostic build: identify actual SSR/client differences during UI acceptance.
  vite: { define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: process.env.NASQ_HYDRATION_DEBUG === '1' } },
  typescript: { strict: true },
})
