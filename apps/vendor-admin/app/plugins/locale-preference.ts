// Applies the language saved by the account menu before the first render.
export default defineNuxtPlugin({
  name: 'liwan-admin-locale-preference',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const saved = usePreferenceCookie<string>(LOCALE_COOKIE, '')
    const i18n = nuxtApp.$i18n as { locale: { value: string }, locales: { value: { code: string }[] }, setLocale: (code: string) => Promise<void> }
    const known = i18n.locales.value.some(locale => locale.code === saved.value)
    if (known && saved.value !== i18n.locale.value) await i18n.setLocale(saved.value)
  },
})
