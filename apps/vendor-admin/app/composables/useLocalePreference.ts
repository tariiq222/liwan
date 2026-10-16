export const LOCALE_COOKIE = 'nasq-admin-locale'

/** The saved language (a cookie, because browser detection is off and Arabic is the default). */
export function useLocalePreference() {
  const { setLocale } = useI18n()
  const saved = usePreferenceCookie<string>(LOCALE_COOKIE, '')
  async function choose(code: Parameters<typeof setLocale>[0]): Promise<void> {
    saved.value = code
    await setLocale(code)
  }
  return { saved, choose }
}
