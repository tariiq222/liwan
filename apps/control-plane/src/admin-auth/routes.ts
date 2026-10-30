import type { IncomingHttpHeaders } from 'node:http'
import type { Pool } from 'pg'
import { z } from 'zod'
import { adminAuthBodies, adminErrorBodySchema, type AdminErrorBody } from '@liwan/commercial-contracts'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { AdminAuthError, audit } from './accounts.js'
import { ipScopeKey } from './attempts.js'
import { CountedFailure, handlers, type AuthContext } from './route-handlers.js'
import type { WebAuthnLib } from './webauthn.js'

const body = adminAuthBodies
const ROUTES: Record<string, { schema: z.ZodType; handler: (ctx: AuthContext, body: never) => Promise<{ status: number; data?: unknown }>; devOnly?: true }> = {
  '/v1/admin/auth/invitation': { schema: body.invitation, handler: handlers.invitation },
  '/v1/admin/auth/enroll/passkey/options': { schema: body['enroll/passkey/options'], handler: handlers.enrollPasskeyOptions },
  '/v1/admin/auth/enroll/passkey/verify': { schema: body['enroll/passkey/verify'], handler: handlers.enrollPasskeyVerify },
  '/v1/admin/auth/enroll/totp': { schema: body['enroll/totp'], handler: handlers.enrollTotp },
  '/v1/admin/auth/enroll/complete': { schema: body['enroll/complete'], handler: handlers.enrollComplete },
  '/v1/admin/auth/passkey/options': { schema: body['passkey/options'], handler: handlers.passkeyOptions },
  '/v1/admin/auth/passkey/verify': { schema: body['passkey/verify'], handler: handlers.passkeyVerify },
  '/v1/admin/auth/fallback': { schema: body.fallback, handler: handlers.fallback },
  '/v1/admin/auth/recovery': { schema: body.recovery, handler: handlers.recovery },
  '/v1/admin/auth/step-up/options': { schema: body['step-up/options'], handler: handlers.stepUpOptions },
  '/v1/admin/auth/step-up/verify': { schema: body['step-up/verify'], handler: handlers.stepUpVerify },
  '/v1/admin/auth/dev-login': { schema: body['dev-login'], handler: handlers.devLogin, devOnly: true },
  '/v1/admin/auth/dev-step-up': { schema: body['dev-step-up'], handler: handlers.devStepUp, devOnly: true },
  '/v1/admin/auth/logout': { schema: body.logout, handler: handlers.logout },
}

type AuthRequest = { method: string; pathname: string; path: string; raw: string | Buffer; headers: IncomingHttpHeaders; remoteAddress?: string }

// Only a request that passed the anonymous service signature (the BFF is the only signer) may name the client address.
// The result is the attempt-scope key of the address (an IPv6 client is counted per /64).
function clientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const forwarded = headers['x-liwan-client-ip']
  if (typeof forwarded === 'string' && forwarded.length <= 64 && /^[0-9a-fA-F:.]+$/.test(forwarded)) return ipScopeKey(forwarded)
  return ipScopeKey(remoteAddress ?? 'unknown')
}

const errorBody = (code: AdminErrorBody['code']): AdminErrorBody => adminErrorBodySchema.parse({ code })

function failure(error: unknown): { status: number; data: AdminErrorBody } {
  if (error instanceof AdminAuthError) {
    if (error.code === 'rate_limited') return { status: 429, data: errorBody('rate_limited') }
    if (error.code === 'invalid') return { status: 422, data: errorBody('invalid') }
    return { status: 401, data: errorBody('auth_failed') }
  }
  // Anything else is a fault of ours (storage, encoding), never a credential verdict. Never log the message: it can carry request material.
  const e = error as { name?: unknown; code?: unknown }
  console.error('admin auth failure', typeof e?.name === 'string' ? e.name : 'unknown', typeof e?.code === 'string' && e.code.length <= 8 ? e.code : '')
  return { status: 503, data: errorBody('admin_unavailable') }
}

// The attempt was already reserved before verification; the failure is audited in its own committed transaction (the handler's has rolled back).
async function auditFailure(pool: Pool, scopes: string[], reason: string, now: Date): Promise<void> {
  await transaction(pool, async (client) => {
    await audit(client, 'anonymous', 'auth.failed', scopes[0], reason)
  })
}

export async function adminAuthHttp(pool: Pool, config: Config, deps: { webauthn: WebAuthnLib; now?: () => Date }, req: AuthRequest): Promise<{ status: number; data?: unknown } | null> {
  if (!req.pathname.startsWith('/v1/admin/auth/')) return null
  const admin = config.admin
  if (!admin) return { status: 503, data: errorBody('admin_unavailable') }
  if (req.method !== 'POST') return { status: 404, data: errorBody('not_found') }
  const now = (deps.now ?? (() => new Date()))()
  try {
    const signed = verifyServiceRequest({ method: req.method, path: req.path, body: req.raw, key: config.key, headers: req.headers, anonymous: true })
    if (!signed || signed.issuer !== config.installationId) throw new AdminAuthError(401, 'auth_failed')
    await transaction(pool, async (client) => {
      await client.query('DELETE FROM service_nonces WHERE expires_at < now()')
      const nonce = await client.query("INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING nonce", [signed.issuer, signed.nonce])
      if (!nonce.rowCount) throw new AdminAuthError(401, 'auth_failed')
    })
    const route = ROUTES[req.pathname]
    // The developer routes do not exist unless ADMIN_DEV_LOGIN_EMAIL is configured.
    if (!route || (route.devOnly && !admin.devLoginEmail)) return { status: 404, data: errorBody('not_found') }
    let json: unknown
    try { json = JSON.parse(Buffer.from(req.raw).toString('utf8')) } catch { throw new AdminAuthError(422, 'invalid') }
    const parsed = route.schema.safeParse(json)
    if (!parsed.success) throw new AdminAuthError(422, 'invalid')
    const ctx: AuthContext = { pool, config, admin, lib: deps.webauthn, now, ip: clientIp(req.headers, req.remoteAddress), headers: req.headers }
    try {
      return await route.handler(ctx, parsed.data as never)
    } catch (error) {
      if (error instanceof CountedFailure) {
        try { await auditFailure(pool, error.scopes, error.reason, now) } catch (countError) { failure(countError) }
      }
      throw error
    }
  } catch (error) {
    return failure(error)
  }
}
