import { isLocaleCode, LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/utils/localePreference'

// The language switch in the account menu is saved in a cookie. `detectBrowserLanguage` is off
// (Arabic is the default), so this plugin applies the saved choice before the first render.
export default defineNuxtPlugin({
  name: 'nasq-admin-locale-preference',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const saved = useCookie<string | null>(LOCALE_COOKIE, { default: () => null, ...LOCALE_COOKIE_OPTIONS })
    const i18n = nuxtApp.$i18n as { locale: { value: string }, setLocale: (code: string) => Promise<void> }
    if (isLocaleCode(saved.value) && saved.value !== i18n.locale.value) await i18n.setLocale(saved.value)
  },
})
