import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { bffConfig } from './config'
import { bffFail } from './errors'

export const SESSION_PATTERN = /^[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$/

export type AdminSession = { accountId: number; value: string }

function cookieSettings(event: H3Event) {
  const { adminOrigin } = bffConfig(event)
  const secure = adminOrigin.protocol === 'https:'
  return { name: secure ? '__Host-nasq_admin' : 'nasq_admin', secure }
}

/** The signed-in session from the cookie, or null when absent or malformed. */
export function readSession(event: H3Event): AdminSession | null {
  const value = getCookie(event, cookieSettings(event).name)
  if (!value || !SESSION_PATTERN.test(value)) return null
  const accountId = Number(value.split('.', 1)[0])
  return Number.isSafeInteger(accountId) ? { accountId, value } : null
}

/** Stores the control plane's session string as the HttpOnly cookie; Max-Age runs to `expiresAt`. */
export function writeSession(event: H3Event, session: string, expiresAt: string): void {
  const { name, secure } = cookieSettings(event)
  const expires = Date.parse(expiresAt)
  if (!SESSION_PATTERN.test(session) || Number.isNaN(expires)) bffFail(503, 'vendor_unavailable')
  setCookie(event, name, session, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((expires - Date.now()) / 1000)),
  })
}

export function clearSession(event: H3Event): void {
  const { name, secure } = cookieSettings(event)
  deleteCookie(event, name, { httpOnly: true, secure, sameSite: 'strict', path: '/' })
}
