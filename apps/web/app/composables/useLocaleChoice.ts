export const LOCALE_COOKIE = 'liwan-locale'
export const LANGUAGES = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }] as const
export type LanguageCode = (typeof LANGUAGES)[number]['code']

/**
 * The language switch: saves the choice in the `liwan-locale` cookie (read back by the locale-preference plugin before
 * the first render) and applies it at once. `other` is the language the switch would change to.
 */
export function useLocaleChoice() {
  const { locale, setLocale } = useI18n()
  const saved = useCookie<string | null>(LOCALE_COOKIE, { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const other = computed(() => LANGUAGES.find(language => language.code !== locale.value) ?? LANGUAGES[0])
  function choose(code: LanguageCode) {
    if (locale.value === code) return
    saved.value = code
    void setLocale(code)
  }
  return { languages: LANGUAGES, other, choose }
}
