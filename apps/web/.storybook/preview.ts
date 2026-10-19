import './storybook.css'
import type { Preview } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { computed, h } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import { ar, en } from '@nuxt/ui/locale'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mswLoader } from 'msw-storybook-addon/csf3'
import messages, { locales } from 'virtual:webvue-i18n'
import { pluralRules } from '../i18n/pluralRules'
import { apiHandlers } from '../stories/handlers/api'
import nuxtUiComponents from 'virtual:webvue-nuxt-ui-components'
import { useAppearance } from '../app/composables/useAppearance'
import { htmlAttrsFor, type AppearanceMode, type FontSize } from '../app/utils/appearance'
import { __resetState, __setRouter } from './nuxt-shims'
import { init as initLucideIcons } from './nuxt-icon-client-bundle-shim.mjs'

// @nuxt/icon's runtime only calls "#build/nuxt-icon-client-bundle"'s init()
// from its own `loadIcon` helper (the CSS-mode render path); priming the same
// @iconify/vue store here too, once, before any component renders, covers
// every icon usage regardless of which internal path resolves it.
initLucideIcons()

// virtual:webvue-i18n's messages are generated per app locale from JSON files,
// so vue-i18n's exact `{ ar, en }` message-map type cannot be declared statically.
const i18n = createI18n({ legacy: false, locale: 'ar', fallbackLocale: 'ar', pluralRules, messages: messages as any })
// @nuxtjs/i18n adds `localeProperties` (the active locale's config, incl. `dir`) to the composer;
// plain vue-i18n lacks it, so components such as SharedCreatePanel threw reading `.value`.
Object.assign(i18n.global, {
  localeProperties: computed(() => locales.find(l => l.code === i18n.global.locale.value) ?? locales[0]!),
})
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] })
__setRouter(router)
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } })

setup((app) => {
  app.use(router)
  app.use(i18n)
  app.use(VueQueryPlugin, { queryClient })
  app.use(ui)
  // Real .vue files get U* tags from Nuxt's own resolver; stories compile
  // inline templates at runtime and need the same tags registered globally.
  for (const [tag, component] of Object.entries(nuxtUiComponents)) app.component(tag, component)
})

// Same attributes app.vue puts on <html>, applied once per render.
function applyDocument(locale: string, mode: AppearanceMode, fontSize: FontSize) {
  const root = document.documentElement
  const current = locales.find(entry => entry.code === locale) ?? locales[0]!
  const attrs = htmlAttrsFor({ mode, fontSize, lang: current.language, dir: current.dir })
  root.classList.remove('dark', 'cream')
  if (attrs.class) root.classList.add(attrs.class)
  root.setAttribute('data-font-size', attrs['data-font-size'])
  if (attrs.lang) root.lang = attrs.lang
  if (attrs.dir) root.dir = attrs.dir
}

const preview: Preview = {
  loaders: [mswLoader(), async () => { queryClient.clear(); __resetState(); return {} }],
  globalTypes: {
    locale: {
      description: 'Language and direction',
      toolbar: { title: 'Locale', icon: 'globe', dynamicTitle: true, items: [{ value: 'ar', title: 'العربية (rtl)' }, { value: 'en', title: 'English (ltr)' }] },
    },
    appearance: {
      description: 'Appearance mode',
      toolbar: { title: 'Appearance', icon: 'mirror', dynamicTitle: true, items: ['light', 'dark', 'cream'] },
    },
    fontSize: {
      description: 'Font size',
      toolbar: { title: 'Font size', icon: 'paragraph', dynamicTitle: true, items: ['small', 'medium', 'large'] },
    },
  },
  initialGlobals: { locale: 'ar', appearance: 'light', fontSize: 'small' },
  decorators: [
    (story, context) => {
      const locale = context.globals.locale === 'en' ? 'en' : 'ar'
      const mode = (context.globals.appearance ?? 'light') as AppearanceMode
      const fontSize = (context.globals.fontSize ?? 'small') as FontSize
      return {
        setup() {
          // Write shared state only when it differs; writing on every render loops on docs pages.
          const appearance = useAppearance()
          if (appearance.mode.value !== mode) appearance.setMode(mode)
          if (appearance.fontSize.value !== fontSize) appearance.setFontSize(fontSize)
          if (i18n.global.locale.value !== locale) i18n.global.locale.value = locale
          applyDocument(locale, mode, fontSize)
          return () => h(UApp, { locale: locale === 'en' ? en : ar }, () => h(story()))
        },
      }
    },
  ],
  parameters: { layout: 'padded', msw: { handlers: { api: apiHandlers } } },
}

export default preview
