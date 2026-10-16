export const LOCALE_COOKIE = 'nasq-admin-locale'
export const LOCALE_CODES = ['ar', 'en'] as const
export type LocaleCode = typeof LOCALE_CODES[number]

export const isLocaleCode = (value: unknown): value is LocaleCode => (LOCALE_CODES as readonly unknown[]).includes(value)

export const LOCALE_COOKIE_OPTIONS = { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 } as const
