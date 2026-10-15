import type { IncomingHttpHeaders } from 'node:http'
import type { Pool } from 'pg'
import { z } from 'zod'
import { verifyServiceRequest } from '@nasq/commercial-contracts/server'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { AdminAuthError, audit } from './accounts.js'
import { CountedFailure, handlers, type AuthContext } from './route-handlers.js'
import type { WebAuthnLib } from './webauthn.js'

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const email = z.string().min(3).max(254)
const password = z.string().min(1).max(256)
const totpCode = z.string().regex(/^\d{6}$/)
const challengeId = z.string().length(36)
const response = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 16384)
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

const ROUTES: Record<string, { schema: z.ZodType; handler: (ctx: AuthContext, body: never) => Promise<{ status: number; data?: unknown }> }> = {
  '/v1/admin/auth/invitation': { schema: strict({ token }), handler: handlers.invitation },
  '/v1/admin/auth/enroll/passkey/options': { schema: strict({ token }), handler: handlers.enrollPasskeyOptions },
  '/v1/admin/auth/enroll/passkey/verify': { schema: strict({ token, challenge_id: challengeId, response, label: z.string().max(60) }), handler: handlers.enrollPasskeyVerify },
  '/v1/admin/auth/enroll/totp': { schema: strict({ token }), handler: handlers.enrollTotp },
  '/v1/admin/auth/enroll/complete': { schema: strict({ token, password, totp_code: totpCode, totp_box: z.string().regex(/^[A-Za-z0-9+/]+=*$/).max(200) }), handler: handlers.enrollComplete },
  '/v1/admin/auth/passkey/options': { schema: strict({}), handler: handlers.passkeyOptions },
  '/v1/admin/auth/passkey/verify': { schema: strict({ challenge_id: challengeId, response }), handler: handlers.passkeyVerify },
  '/v1/admin/auth/fallback': { schema: strict({ email, password, totp_code: totpCode }), handler: handlers.fallback },
  '/v1/admin/auth/recovery': { schema: strict({ email, password, recovery_code: z.string().length(14) }), handler: handlers.recovery },
  '/v1/admin/auth/step-up/options': { schema: strict({}), handler: handlers.stepUpOptions },
  '/v1/admin/auth/step-up/verify': { schema: strict({ challenge_id: challengeId, response }), handler: handlers.stepUpVerify },
  '/v1/admin/auth/logout': { schema: strict({}), handler: handlers.logout },
}

type AuthRequest = { method: string; pathname: string; path: string; raw: string | Buffer; headers: IncomingHttpHeaders; remoteAddress?: string }

// Only a request that passed the anonymous service signature (the BFF is the only signer) may name the client address.
function clientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const forwarded = headers['x-nasq-client-ip']
  if (typeof forwarded === 'string' && forwarded.length <= 64 && /^[0-9a-fA-F:.]+$/.test(forwarded)) return forwarded
  return remoteAddress ?? 'unknown'
}

function failure(error: unknown): { status: number; data: { code: string } } {
  if (error instanceof AdminAuthError) {
    if (error.code === 'rate_limited') return { status: 429, data: { code: 'rate_limited' } }
    if (error.code === 'invalid') return { status: 422, data: { code: 'invalid' } }
    return { status: 401, data: { code: 'auth_failed' } }
  }
  // Never the message: it can carry request material.
  const e = error as { name?: unknown; code?: unknown }
  console.error('admin auth failure', typeof e?.name === 'string' ? e.name : 'unknown', typeof e?.code === 'string' && e.code.length <= 8 ? e.code : '')
  return { status: 401, data: { code: 'auth_failed' } }
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
  if (!admin) return { status: 503, data: { code: 'admin_unavailable' } }
  if (req.method !== 'POST') return { status: 404, data: { code: 'not_found' } }
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
    if (!route) return { status: 404, data: { code: 'not_found' } }
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
