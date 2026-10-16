/** The service answers in English only when the `webvue-locale` cookie holds an English locale; every other value is Arabic, the default. */
export function runLocale(cookieValue: string | undefined): 'en' | 'ar' {
  return /^en(-|$)/i.test(cookieValue ?? '') ? 'en' : 'ar'
}
