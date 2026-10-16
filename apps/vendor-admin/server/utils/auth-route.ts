import type { H3Event } from 'h3'
import { z } from 'zod'
import { AUTH_INVALID, readJsonObject } from './body'
import { bffConfig } from './config'
import { controlCall, type ControlResult } from './control'
import { bffFail, bffHandler, respond } from './errors'
import { assertSameOrigin } from './origin'
import { clearSession, readSession, writeSession, type AdminSession } from './session-cookie'

// Field limits are those of the control plane's admin-auth routes.
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const challengeId = z.string().length(36)
const response = z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 16384)
export const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
export const authFields = {
  token,
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/),
  challengeId,
  response,
}

const sessionResult = z.object({
  session: z.string(),
  expires_at: z.string(),
  idle_expires_at: z.string(),
  recovery_codes: z.array(z.string()).optional(),
}).passthrough()

/** Stores the session cookie from a sign-in result; the browser receives only the expiry (and recovery codes). */
export function completeSignIn(event: H3Event, result: ControlResult): unknown {
  const parsed = sessionResult.safeParse(result.data)
  if (!parsed.success) return bffFail(503, 'vendor_unavailable')
  const { session, expires_at, idle_expires_at, recovery_codes } = parsed.data
  writeSession(event, session, expires_at)
  return respond(event, 200, { expires_at, idle_expires_at, ...(recovery_codes ? { recovery_codes } : {}) })
}

export type AuthRouteSpec = {
  /** Control-plane path under /v1/admin/auth/. */
  path: string
  schema: z.ZodType
  /** `required`: the cookie must be present (401 otherwise); `none`: never sent upstream. */
  session: 'required' | 'none'
  onSuccess?: (event: H3Event, result: ControlResult) => unknown
}

/**
 * A 401 on a step-up route is either a dead session or a failed passkey assertion, and only the
 * first must end the local session: ask the control plane who the cookie belongs to.
 */
async function sessionIsGone(event: H3Event, session: AdminSession): Promise<boolean> {
  const me = await controlCall(event, { path: '/v1/admin/me', method: 'GET', session })
  return me.status === 401
}

/** A POST route that validates the body, signs it as the anonymous actor and relays the result. */
export function authRoute(name: string, spec: AuthRouteSpec) {
  return bffHandler(name, async (event) => {
    bffConfig(event)
    assertSameOrigin(event)
    const { json } = await readJsonObject(event, AUTH_INVALID)
    const parsed = spec.schema.safeParse(json)
    if (!parsed.success) return bffFail(AUTH_INVALID.status, AUTH_INVALID.code)
    let session: AdminSession | undefined
    if (spec.session === 'required') session = readSession(event) ?? bffFail(401, 'auth_failed')
    const result = await controlCall(event, { path: spec.path, method: 'POST', body: parsed.data as object, anonymous: true, session })
    if (result.status === 401 && session && await sessionIsGone(event, session)) clearSession(event)
    if (result.status >= 400) return respond(event, result.status, result.data)
    return spec.onSuccess ? spec.onSuccess(event, result) : respond(event, result.status, result.data)
  })
}

/** Ends the session: the cookie is cleared whatever the control plane answers. */
export const logoutRoute = bffHandler('logout', async (event) => {
  bffConfig(event)
  assertSameOrigin(event)
  const { json } = await readJsonObject(event, AUTH_INVALID)
  if (!strict({}).safeParse(json).success) bffFail(AUTH_INVALID.status, AUTH_INVALID.code)
  const session = readSession(event)
  clearSession(event)
  if (!session) return respond(event, 204)
  const result = await controlCall(event, { path: '/v1/admin/auth/logout', method: 'POST', body: {}, anonymous: true, session })
  // Only the genuine "this session is not valid" answer means it was already signed out.
  const alreadyOut = result.status === 401 && (result.data as { code?: unknown } | undefined)?.code === 'auth_failed'
  return alreadyOut ? respond(event, 204) : respond(event, result.status, result.data)
})

/** The profile behind the cookie; an absent, expired or revoked session is 401 auth_failed. */
export const sessionRoute = bffHandler('session', async (event) => {
  bffConfig(event)
  const session = readSession(event)
  if (!session) return bffFail(401, 'auth_failed')
  const result = await controlCall(event, { path: '/v1/admin/me', method: 'GET', session })
  if (result.status === 401) {
    clearSession(event)
    return bffFail(401, 'auth_failed')
  }
  return respond(event, result.status, result.data)
})
