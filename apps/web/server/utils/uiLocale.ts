import { getCookie } from 'h3'
import type { H3Event } from 'h3'

// The web app keeps the UI language in this cookie (app/plugins/locale-preference.ts); Odoo localizes
// its own text (lookup labels, seeded names) by the same language, never by the stored user language.
export const UI_LOCALE_COOKIE = 'liwan-locale'
export const UI_LOCALE_HEADER = 'x-liwan-ui-locale'
const SUPPORTED = new Set(['ar', 'en'])

/** The upstream header for this request's UI language: only a supported cookie value, else nothing. */
export function uiLocaleHeaders(event: H3Event): Record<string, string> {
  const value = getCookie(event, UI_LOCALE_COOKIE)
  return value && SUPPORTED.has(value) ? { [UI_LOCALE_HEADER]: value } : {}
}

/** The headers a request forwards without a tenant binding: the browser's own, with the UI language rebuilt from the cookie. */
export function withUiLocale(event: H3Event, headers: Record<string, string>): Record<string, string> {
  const { [UI_LOCALE_HEADER]: _forged, ...rest } = headers
  return { ...rest, ...uiLocaleHeaders(event) }
}
