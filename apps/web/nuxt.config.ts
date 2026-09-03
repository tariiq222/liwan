import tailwindcss from '@tailwindcss/vite'

const odoo = process.env.NUXT_ODOO_URL ?? 'http://localhost:8069'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['shadcn-nuxt', '@vueuse/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: {
    head: {
      htmlAttrs: { lang: 'ar', dir: 'rtl' },
      title: 'nasq',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
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
