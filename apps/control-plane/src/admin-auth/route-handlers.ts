import type { IncomingHttpHeaders } from 'node:http'
import type { Pool, PoolClient } from 'pg'
import { adminChallengeResultSchema, adminInvitationInfoSchema, adminSessionResultSchema, adminTotpEnrollmentSchema } from '@nasq/commercial-contracts'
import type { AdminConfig, Config } from '../config.js'
import { transaction } from '../db.js'
import { AdminAuthError, audit, normalizeEmail } from './accounts.js'
import { recordSuccess, reserveAttempt } from './attempts.js'
import { hashToken, open, seal, totpBoxAad } from './crypto.js'
import { completeEnrollment, openInvitation } from './enrollment.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { createSession, markStepUp, resolveSession, revokeSession } from './sessions.js'
import { checkTotp, newTotpSecret, totpUri } from './totp.js'
import { authenticationOptions, consumeChallenge, finishAuthentication, finishRegistration, registrationOptions, type WebAuthnLib } from './webauthn.js'

export type AuthContext = { pool: Pool; config: Config; admin: AdminConfig; lib: WebAuthnLib; now: Date; ip: string; headers: IncomingHttpHeaders }
type Result = { status: number; data?: unknown }
// A failure that counts against the given attempt scopes; the dispatcher records it after the handler's transaction rolled back.
export class CountedFailure extends AdminAuthError {
  constructor(public scopes: string[], public reason: string) { super(401, 'auth_failed') }
}
const counted = (scopes: string[], reason: string): AdminAuthError => new CountedFailure(scopes, reason)

const authFailed = () => new AdminAuthError(401, 'auth_failed')
const sessionBody = (s: { session: string; expiresAt: Date; idleExpiresAt: Date }, recoveryCodes?: string[]) =>
  adminSessionResultSchema.parse({ session: s.session, expires_at: s.expiresAt.toISOString(), idle_expires_at: s.idleExpiresAt.toISOString(), ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}) })
const tx = <T>(ctx: AuthContext, action: (client: PoolClient) => Promise<T>) => transaction(ctx.pool, action)

// Verified once so unknown emails cost the same as wrong passwords.
let dummyHash: Promise<string> | undefined
const dummy = () => (dummyHash ??= hashPassword('nasq dummy password for timing'))

function sessionHeader(ctx: AuthContext): string {
  const value = ctx.headers['x-nasq-session']
  if (typeof value !== 'string') throw authFailed()
  return value
}

async function passwordLogin(ctx: AuthContext, client: PoolClient, scopes: string[], emailRaw: string, passwordText: string, route: string): Promise<{ id: number; scopes: string[] }> {
  const email = normalizeEmail(emailRaw)
  // Find the account, take its lock (shared) before any credential or session row, then read it again under the lock.
  const found = (await client.query('SELECT id FROM vendor_accounts WHERE email=$1', [email])).rows[0]
  const row = found ? (await client.query("SELECT id, password_hash FROM vendor_accounts WHERE id=$1 AND status='active' FOR SHARE", [found.id])).rows[0] : undefined
  const ok = await verifyPassword(row?.password_hash ?? await dummy(), passwordText)
  if (!row || !row.password_hash || !ok) throw counted(scopes, route)
  return { id: Number(row.id), scopes }
}

async function finishSignIn(ctx: AuthContext, client: PoolClient, accountId: number, scopes: string[], reason: string) {
  await recordSuccess(client, scopes)
  const session = await createSession(client, accountId, ctx.now, false)
  await audit(client, `account:${accountId}`, 'auth.signed_in', `account:${accountId}`, reason)
  return { status: 200, data: sessionBody(session) }
}

export const handlers = {
  async invitation(ctx: AuthContext, body: { token: string }): Promise<Result> {
    const inv = await tx(ctx, (c) => openInvitation(c, body.token, ctx.now))
    return { status: 200, data: adminInvitationInfoSchema.parse({ email: inv.email, purpose: inv.purpose }) }
  },
  async enrollPasskeyOptions(ctx: AuthContext, body: { token: string }): Promise<Result> {
    return tx(ctx, async (c) => {
      const inv = await openInvitation(c, body.token, ctx.now)
      const name = (await c.query('SELECT display_name FROM vendor_accounts WHERE id=$1', [inv.accountId])).rows[0].display_name as string
      const { challengeId, options } = await registrationOptions(c, ctx.lib, ctx.admin, { id: inv.accountId, email: inv.email, displayName: name }, ctx.now)
      return { status: 200, data: adminChallengeResultSchema.parse({ challenge_id: challengeId, options }) }
    })
  },
  async enrollPasskeyVerify(ctx: AuthContext, body: { token: string; challenge_id: string; response: unknown; label: string }): Promise<Result> {
    const consumed = await consumeChallenge(ctx.pool, body.challenge_id, 'register', ctx.now)
    return tx(ctx, async (c) => {
      const inv = await openInvitation(c, body.token, ctx.now)
      await finishRegistration(c, ctx.lib, ctx.admin, inv.accountId, consumed, body.response, body.label, ctx.now)
      await audit(c, `account:${inv.accountId}`, 'auth.passkey_registered', `account:${inv.accountId}`, inv.purpose)
      return { status: 204 }
    })
  },
  async enrollTotp(ctx: AuthContext, body: { token: string }): Promise<Result> {
    const inv = await tx(ctx, (c) => openInvitation(c, body.token, ctx.now))
    const secret = newTotpSecret()
    return { status: 200, data: adminTotpEnrollmentSchema.parse({ totp_uri: totpUri(secret, inv.email), totp_box: seal(ctx.admin.secretKey, secret, totpBoxAad(inv.accountId)).toString('base64') }) }
  },
  async enrollComplete(ctx: AuthContext, body: { token: string; password: string; totp_code: string; totp_box: string }): Promise<Result> {
    return tx(ctx, async (c) => {
      const inv = await openInvitation(c, body.token, ctx.now)
      // Derived from the database, never from the request: a passkey registered during this invitation.
      const registered = await c.query('SELECT 1 FROM vendor_passkeys p JOIN vendor_invitations i ON i.token_hash=$2 WHERE p.account_id=$1 AND p.created_at >= i.created_at LIMIT 1', [inv.accountId, hashToken(body.token)])
      const done = await completeEnrollment(c, body.token, { password: body.password, totpCode: body.totp_code, totpSecretBox: Buffer.from(body.totp_box, 'base64'), passkeyRegistered: Boolean(registered.rowCount) }, ctx.admin.secretKey, ctx.now)
      const session = await createSession(c, done.accountId, ctx.now, true)
      return { status: 200, data: sessionBody(session, done.recoveryCodes) }
    })
  },
  async passkeyOptions(ctx: AuthContext): Promise<Result> {
    const { challengeId, options } = await tx(ctx, (c) => authenticationOptions(c, ctx.lib, ctx.admin, 'login', null, ctx.now))
    return { status: 200, data: adminChallengeResultSchema.parse({ challenge_id: challengeId, options }) }
  },
  async passkeyVerify(ctx: AuthContext, body: { challenge_id: string; response: unknown }): Promise<Result> {
    const scopes = [`ip:${ctx.ip}`]
    await reserveAttempt(ctx.pool, scopes, ctx.now)
    try {
      const consumed = await consumeChallenge(ctx.pool, body.challenge_id, 'login', ctx.now)
      return await tx(ctx, async (c) => {
        const { accountId } = await finishAuthentication(c, ctx.lib, ctx.admin, 'login', consumed, body.response, ctx.now)
        const session = await createSession(c, accountId, ctx.now, true)
        await recordSuccess(c, scopes)
        await audit(c, `account:${accountId}`, 'auth.signed_in', `account:${accountId}`, 'passkey')
        return { status: 200, data: sessionBody(session) }
      })
    } catch (error) {
      throw error instanceof AdminAuthError && error.code === 'auth_failed' ? counted(scopes, 'passkey/verify') : error
    }
  },
  async fallback(ctx: AuthContext, body: { email: string; password: string; totp_code: string }): Promise<Result> {
    const scopes = [`account:${normalizeEmail(body.email)}`, `ip:${ctx.ip}`]
    await reserveAttempt(ctx.pool, scopes, ctx.now)
    return tx(ctx, async (c) => {
      const { id } = await passwordLogin(ctx, c, scopes, body.email, body.password, 'fallback')
      // Row lock: two concurrent uses of one code cannot both pass the last_step check.
      const totp = (await c.query('SELECT secret_box, last_step FROM vendor_totp WHERE account_id=$1 FOR UPDATE', [id])).rows[0]
      const step = totp ? checkTotp(open(ctx.admin.secretKey, totp.secret_box, totpBoxAad(id)), body.totp_code, ctx.now.getTime(), Number(totp.last_step)) : null
      if (step === null) throw counted(scopes, 'fallback')
      await c.query('UPDATE vendor_totp SET last_step=$2 WHERE account_id=$1', [id, step])
      return finishSignIn(ctx, c, id, scopes, 'fallback')
    })
  },
  async recovery(ctx: AuthContext, body: { email: string; password: string; recovery_code: string }): Promise<Result> {
    const scopes = [`account:${normalizeEmail(body.email)}`, `ip:${ctx.ip}`]
    await reserveAttempt(ctx.pool, scopes, ctx.now)
    return tx(ctx, async (c) => {
      const { id } = await passwordLogin(ctx, c, scopes, body.email, body.password, 'recovery')
      const used = await c.query('UPDATE vendor_recovery_codes SET used_at=$3 WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING 1', [id, hashToken(body.recovery_code.trim().toLowerCase()), ctx.now])
      if (!used.rowCount) throw counted(scopes, 'recovery')
      return finishSignIn(ctx, c, id, scopes, 'recovery')
    })
  },
  async stepUpOptions(ctx: AuthContext): Promise<Result> {
    const value = sessionHeader(ctx)
    return tx(ctx, async (c) => {
      const session = await resolveSession(c, value, ctx.now)
      const { challengeId, options } = await authenticationOptions(c, ctx.lib, ctx.admin, 'step_up', session.accountId, ctx.now)
      return { status: 200, data: adminChallengeResultSchema.parse({ challenge_id: challengeId, options }) }
    })
  },
  async stepUpVerify(ctx: AuthContext, body: { challenge_id: string; response: unknown }): Promise<Result> {
    const value = sessionHeader(ctx)
    try {
      const consumed = await consumeChallenge(ctx.pool, body.challenge_id, 'step_up', ctx.now)
      return await tx(ctx, async (c) => {
        const session = await resolveSession(c, value, ctx.now)
        if (consumed.accountId !== session.accountId) throw authFailed()
        const { accountId } = await finishAuthentication(c, ctx.lib, ctx.admin, 'step_up', consumed, body.response, ctx.now)
        if (accountId !== session.accountId) throw authFailed()
        await markStepUp(c, session.tokenHash, ctx.now)
        await audit(c, `account:${accountId}`, 'auth.step_up', `account:${accountId}`, 'passkey')
        return { status: 204 }
      })
    } catch (error) {
      if (error instanceof AdminAuthError && error.code === 'auth_failed') {
        // The handler's transaction rolled back: audit in its own committed one, only for a live session.
        await tx(ctx, async (c) => {
          const session = await resolveSession(c, value, ctx.now).catch(() => null)
          if (session) await audit(c, 'anonymous', 'auth.failed', `account:${session.accountId}`, 'step-up')
        }).catch(() => undefined)
      }
      throw error
    }
  },
  async logout(ctx: AuthContext): Promise<Result> {
    const value = sessionHeader(ctx)
    return tx(ctx, async (c) => {
      const session = await resolveSession(c, value, ctx.now)
      await revokeSession(c, session.tokenHash)
      await audit(c, `account:${session.accountId}`, 'auth.signed_out', `account:${session.accountId}`, 'logout')
      return { status: 204 }
    })
  },
}
