import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { hashToken } from '../commercial/invitation-tokens.js'
import { WORKER_EFFECT_TIMEOUT_MS, type EffectRequest } from './internal-effect-protocol.js'
import { EFFECT_KILL_GRACE_MS, openEffectChannel, type ChannelDeps, type EffectName } from './effect-channel.js'

const allowed = new Set(['user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed'])

export type EffectRunOptions = { timeoutMs?: number; killGraceMs?: number; deps?: ChannelDeps }

/**
 * Runs one lifecycle effect through the effect channel: the request goes in through the stream only, one JSON line comes back
 * and then the gate's exit status. Only an `allowedCodes` refusal reaches the caller by name; anything else is `script_failed`.
 * On a failure the channel is stopped (SIGTERM, SIGKILL after the grace period) and the request is failed regardless.
 */
export function runEffectChild(input: { config: Config; effect: EffectName; request: unknown; signal: AbortSignal; allowedCodes: ReadonlySet<string> } & EffectRunOptions): Promise<unknown> {
  const { signal, allowedCodes } = input
  const graceMs = input.killGraceMs ?? EFFECT_KILL_GRACE_MS
  return new Promise<unknown>((resolve, reject) => {
    let message: unknown, received = false, errorCode: string | undefined, settled = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort)
      try { fn() } finally { message = undefined }
    }
    const fail = (code = 'script_failed') => {
      errorCode ??= code
      if (settled) return
      channel.stop()
      killTimer ??= setTimeout(() => finish(() => reject(Error(errorCode))), graceMs)
    }
    const channel = openEffectChannel({ config: input.config, effect: input.effect, request: input.request, killGraceMs: input.killGraceMs, deps: input.deps,
      onFault: () => fail(),
      onLine: line => {
        if (received) return fail()
        received = true
        try { message = JSON.parse(line) } catch { fail() }
      },
      onClose: exitCode => finish(() => {
        try {
          if (errorCode) throw Error(errorCode)
          const reply = message as { error_code?: unknown; result?: unknown } | null | undefined
          if (reply && Object.keys(reply).length === 1 && typeof reply.error_code === 'string')
            throw Error(allowedCodes.has(reply.error_code) ? reply.error_code : 'script_failed')
          if (exitCode !== 0 || !reply || Object.keys(reply).length !== 1 || !Object.hasOwn(reply, 'result')) throw Error('script_failed')
          resolve(reply.result)
        } catch (e) {
          reject(Error(e instanceof Error && allowedCodes.has(e.message) ? e.message : 'script_failed'))
        }
      }) })
    const abort = () => fail()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => fail(), input.timeoutMs ?? WORKER_EFFECT_TIMEOUT_MS)
    if (signal.aborted) fail()
  })
}

/** Runs tools/shared_saas_lifecycle/admin_password_effect.py for one accepted invitation.
 * The password reaches the child through stdin only; argv, environment and logs never carry it.
 * Authority is the provisioned onboarding/active route AND a still-open invitation for the same
 * tenant and login (the token is hashed for the lookup, never stored or forwarded). */
export function createAdminPasswordRunner(pool: Pool, config: Config, opts: EffectRunOptions = {}) {
  return async (input: EffectRequest, signal: AbortSignal): Promise<unknown> => {
    // Accepted invitation identity is still checked against the provisioned
    // onboarding and active route; never resolve a caller-supplied database.
    const rows = await pool.query(`SELECT b.database_name,b.host FROM shared_registry_bindings b
      JOIN shared_onboardings o ON o.control_tenant_id=b.control_tenant_id AND o.database_name=b.database_name AND o.host=b.host
      JOIN tenants t ON t.id=b.control_tenant_id
      WHERE b.control_tenant_id=$1 AND b.enabled=true AND o.stage='active' AND o.admin_login=$2
        AND t.commercial_mode='saas' AND t.status='active'`, [input.tenant_id, input.admin_login])
    if (rows.rowCount !== 1) throw Error('user_missing')
    const invitation = await pool.query(`SELECT 1 FROM admin_invitations WHERE token_hash=$1 AND tenant_id=$2 AND admin_login=$3
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()`, [hashToken(input.token), input.tenant_id, input.admin_login])
    if (invitation.rowCount !== 1) throw Error('user_missing')
    if (signal.aborted) throw Error('script_failed')
    return runEffectChild({ config, effect: 'admin_password_effect', signal, allowedCodes: allowed, ...opts,
      request: { action: 'set_admin_password', tenant: { database: rows.rows[0].database_name, host: rows.rows[0].host },
        login: input.admin_login, password: input.password } })
  }
}
