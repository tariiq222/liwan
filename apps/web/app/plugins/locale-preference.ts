// The language switch in the account menu is saved in a cookie. `detectBrowserLanguage` is off
// (Arabic is the default), so this plugin applies the saved choice before the first render.
export const LOCALE_COOKIE = 'liwan-locale'
export const LOCALE_CODES = ['ar', 'en'] as const

export default defineNuxtPlugin({
  name: 'liwan-locale-preference',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const saved = useCookie<string | null>(LOCALE_COOKIE, { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
    const i18n = nuxtApp.$i18n as { locale: { value: string }, setLocale: (code: string) => Promise<void> }
    if (saved.value && (LOCALE_CODES as readonly string[]).includes(saved.value) && saved.value !== i18n.locale.value) await i18n.setLocale(saved.value)
  },
})
