// The node project does not pick up the module option types on its own; this generated file adds them.
/// <reference path="./.nuxt/types/modules.d.ts" />
import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'
import { discoverLocaleFiles } from './i18n/localeFiles'

const localeFiles = discoverLocaleFiles(fileURLToPath(new URL('./i18n/locales', import.meta.url)))

export default defineNuxtConfig({
  extends: ['@liwan/ui', '@liwan/commercial-ui'],
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
      title: 'liwan',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', sizes: '32x32', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  i18n: {
    locales: [
      { code: 'ar', language: 'ar', dir: 'rtl', name: 'العربية', files: localeFiles.ar },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: localeFiles.en },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },
  // Private BFF settings (NUXT_CONTROL_URL, NUXT_SERVICE_KEY, NUXT_INSTALLATION_ID,
  // NUXT_ADMIN_ORIGIN, NUXT_TRUST_PROXY). Only `public.devLogin` (NUXT_PUBLIC_DEV_LOGIN, local development only) is public. With an https adminOrigin
  // trustProxy must be true (the BFF answers 503 otherwise); port 3100 is then internal-only,
  // reachable from the edge alone, because x-forwarded-for is trusted.
  runtimeConfig: {
    controlUrl: '',
    serviceKey: '',
    installationId: '',
    adminOrigin: '',
    trustProxy: false,
    // Local development only: shows the "دخول التطوير" buttons and, with a loopback http adminOrigin and a loopback caller, opens the BFF dev routes.
    public: { devLogin: false },
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
    define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: process.env.LIWAN_HYDRATION_DEBUG === '1' },
  },
  typescript: { strict: true },
})
