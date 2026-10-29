import { fileURLToPath } from 'node:url'
import { discoverLocaleFiles } from './i18n/localeFiles'

const localeFiles = discoverLocaleFiles(fileURLToPath(new URL('./i18n/locales', import.meta.url)))

// Shared multi-tenant lane is opt-in. Dedicated (default) keeps the historical topology:
// Nuxt talks to Odoo directly and routeRules proxy Odoo browser paths.
const tenancyMode = process.env.WEBVUE_TENANCY_MODE ?? 'dedicated'
if (!['dedicated', 'shared'].includes(tenancyMode)) throw new Error('invalid_tenancy_mode')
const shared = tenancyMode === 'shared'
const odoo = process.env.NUXT_ODOO_URL ?? (shared ? 'http://guard:8080' : 'http://localhost:8069')
const odooWebsocket = new URL('/websocket', odoo)
odooWebsocket.protocol = odooWebsocket.protocol === 'https:' ? 'wss:' : 'ws:'

export default defineNuxtConfig({
  extends: ['@webvue/ui', '@webvue/commercial-ui'],
  // Test helpers must never become pages or production browser chunks.
  ignore: ['**/__tests__/**'],
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
  icon: {
    provider: 'none',
    fallbackToApi: false,
    clientBundle: {
      scan: {
        // Keep Nuxt Icon's default source patterns and include composable
        // TypeScript where shared dynamic UIcon names are declared (composables,
        // the application manifests, and the component/util helpers that build
        // tiles and tags).
        globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', 'app/composables/**/*.ts', 'app/modules/**/*.ts', 'app/components/**/*.ts', 'app/utils/**/*.ts'],
      },
    },
  },
  // Discover runtime components; specialist chart adapters also use explicit imports.
  // Application folders keep their historical auto-import names through `prefix`
  // (components/pmo/projects/ProjectTable.vue stays ProjectTable); the shared groups
  // drop their group folder (components/shared/data/CommentThread.vue is SharedCommentThread). The presentational
  // groups (layout, feedback, and most of data and form) come from the @webvue/ui layer. Specific folders
  // come first: a file belongs to the first entry whose path contains it.
  components: [
    { path: '~/components/pmo/projects', prefix: 'Project', ignore: ['**/__tests__/**'] },
    { path: '~/components/pmo/tasks', prefix: 'Task', ignore: ['**/__tests__/**'] },
    { path: '~/components/personal-tasks', prefix: 'MyTasks', ignore: ['**/__tests__/**'] },
    { path: '~/components/shared/data', prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'] },
    { path: '~/components/shared/form', prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'] },
    { path: '~/components', ignore: ['**/__tests__/**'] },
  ],
  app: {
    head: {
      title: 'webvue',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  i18n: {
    experimental: { prerenderMessages: true },
    // One file per pillar namespace, merged by @nuxtjs/i18n into a single
    // message object per locale — key paths are unchanged ($t('tasks.state.done')
    // still resolves). A pillar owns its own namespace file: adding
    // i18n/locales/{ar,en}/<name>.json is enough. The files list is discovered
    // from the locale folders (common.json first); a missing ar/en pair fails the load.
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', files: localeFiles.ar },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: localeFiles.en },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },
  // Dev-only Odoo WS bypass. Shared keeps same-origin WS through the guard, so the
  // dev proxy is not registered there (deploy/shared/Caddyfile carries the WS route).
  nitro: {
    // Literal bundled into the server plugin, outside runtimeConfig/env overrides.
    replace: { __WEBVUE_BUILD_TENANCY_MODE__: JSON.stringify(tenancyMode) },
    ...(shared ? {} : { devProxy: {
      '/websocket': { target: odooWebsocket.href, ws: true, changeOrigin: false },
    } }),
  },
  runtimeConfig: {
    // Customer-scoped commercial BFF (disabled by default; own service identity).
    customerCommercialEnabled: false,
    customerCommercialControlUrl: '',
    customerCommercialServiceKey: '',
    customerCommercialIssuer: '',
    customerCommercialPublicOrigin: '',
    customerCommercialTenantId: '',
    odooUrl: odoo,
    odooDb: shared ? '' : (process.env.NUXT_ODOO_DB ?? 'odoo19'),
    // Opt-in only behind the dedicated edge that overwrites private identity fields.
    authProxyClientIpHeader: '',
    // WebVue AI service (apps/ai-service). Empty hides /ai and disables the executor.
    aiServiceUrl: process.env.NUXT_AI_SERVICE_URL ?? '',
    // Shared secret the AI service requires in X-WebVue-Service-Token (empty = none sent).
    aiServiceToken: process.env.NUXT_AI_SERVICE_TOKEN ?? '',
    public: {
      customerCommercialEnabled: false,
      // Filled at server start from the runtime `aiServiceUrl` (server/plugins/ai-enabled.ts), never from the build environment.
      aiEnabled: false,
      // Dev: the Nitro dev proxy above does not upgrade websockets, so
      // useBus() connects directly to the configured Odoo in dev. Prod: left empty
      // so useBus() falls back to same-origin (Caddy routes /websocket through).
      // `process.dev` is a runtime (app-code) global, not available while
      // nuxt.config.ts itself is evaluated - NODE_ENV is what `nuxt dev` sets here.
      wsUrl: shared ? '' : (process.env.NUXT_PUBLIC_WS_URL ?? (process.env.NODE_ENV !== 'production' ? odooWebsocket.href : '')),
    },
  },
  // Browser-only paths, dev convenience: in production Caddy routes them to Odoo. SSR
  // fetches to /api/v1/** go through server/routes/api/v1/[...path].ts, which reads
  // odooUrl at runtime.
  //
  // Shared lane: these routeRules bypass the guard by proxying straight to Odoo, so in
  // shared mode they are removed entirely and the edge sends every Odoo path to the guard
  // (deploy/shared/Caddyfile). Dedicated keeps every rule unchanged.
  routeRules: {
    // Retired customer URLs keep working: permanent redirects that carry the query string along.
    '/archived-tasks': { redirect: { to: '/tasks?scope=archived', statusCode: 301 } },
    '/reports': { redirect: { to: '/projects/dashboard', statusCode: 301 } },
    // The pay pages carry a document's access token in their address: never send it as a referrer
    // (to the gateway or any other origin) and never keep the page in a shared cache.
    '/pay/**': { headers: { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } },
    // The booking page carries a booking's access token in its address: the same rule.
    '/book/**': { headers: { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } },
    // Keep future security/cache rules outside this proxy-only spread.
    ...(shared ? {} : {
    // The only stock routes left (ir.http guard in webvue_platform): session, assets and images.
    // Keep Odoo's redirects and login Set-Cookie response in the browser.
    '/web/**': { proxy: { to: `${odoo}/web/**`, fetchOptions: { redirect: 'manual' } } },
    }),
  },
  // Opt-in diagnostic build: identify actual SSR/client differences during UI acceptance.
  vite: {
    define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: process.env.WEBVUE_HYDRATION_DEBUG === '1' },
    // Pre-bundle deps that only lazily-loaded pages import. Discovered late,
    // Vite re-optimizes and changes the dep hash, so an open page's module
    // imports fail with 504 "Outdated Optimize Dep" and the route errors.
    optimizeDeps: { include: ['@tanstack/vue-table'] },
  },
  typescript: { strict: true },
})
