import type { H3Event } from 'h3'
import { z } from 'zod'
import { adminAuthFields, adminAuthResults, adminErrorBodySchema, adminMeSchema, adminSessionResultSchema } from '@webvue/commercial-contracts'
import { AUTH_INVALID, readJsonObject } from './body'
import { bffConfig, devLoginEnabled } from './config'
import { controlCall, type ControlResult } from './control'
import { bffFail, bffHandler, respond } from './errors'
import { assertSameOrigin } from './origin'
import { clearSession, readSession, writeSession, type AdminSession } from './session-cookie'

export const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
// Field limits, response shapes and the error body are the control plane's: one definition in the contracts package.
export const authFields = adminAuthFields

/** Stores the session cookie from a sign-in result; the browser receives only the expiry (and recovery codes). */
export function completeSignIn(event: H3Event, result: ControlResult): unknown {
  const parsed = adminSessionResultSchema.safeParse(result.data)
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
  /** Developer sign-in route: answers 404 unless `devLoginEnabled`. */
  devOnly?: true
}

/** A control-plane failure reaches the browser only in the contract's error shape; anything else is an outage. */
function relayFailure(event: H3Event, result: ControlResult): unknown {
  const parsed = adminErrorBodySchema.safeParse(result.data)
  return parsed.success ? respond(event, result.status, parsed.data) : bffFail(503, 'vendor_unavailable')
}

/** The routes that answer with data are parsed with their contract schema; the others answer 204 and have no body. */
function relaySuccess(event: H3Event, path: string, result: ControlResult): unknown {
  const schema = (adminAuthResults as Record<string, z.ZodType | undefined>)[path.slice('/v1/admin/auth/'.length)]
  if (!schema) return respond(event, result.status, result.data)
  const parsed = schema.safeParse(result.data)
  return parsed.success ? respond(event, result.status, parsed.data) : bffFail(503, 'vendor_unavailable')
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
    if (spec.devOnly && !devLoginEnabled(event)) return bffFail(404, 'not_found')
    bffConfig(event)
    assertSameOrigin(event)
    const { json } = await readJsonObject(event, AUTH_INVALID)
    const parsed = spec.schema.safeParse(json)
    if (!parsed.success) return bffFail(AUTH_INVALID.status, AUTH_INVALID.code)
    let session: AdminSession | undefined
    if (spec.session === 'required') session = readSession(event) ?? bffFail(401, 'auth_failed')
    const result = await controlCall(event, { path: spec.path, method: 'POST', body: parsed.data as object, anonymous: true, session })
    if (result.status === 401 && session && await sessionIsGone(event, session)) clearSession(event)
    if (result.status >= 400) return relayFailure(event, result)
    if (spec.onSuccess) return spec.onSuccess(event, result)
    return relaySuccess(event, spec.path, result)
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
  if (alreadyOut) return respond(event, 204)
  return result.status >= 400 ? relayFailure(event, result) : respond(event, result.status, result.data)
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
  if (result.status >= 400) return relayFailure(event, result)
  const me = adminMeSchema.safeParse(result.data)
  return me.success ? respond(event, result.status, me.data) : bffFail(503, 'vendor_unavailable')
})
