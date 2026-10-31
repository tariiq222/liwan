import { spawn } from 'node:child_process'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { hashToken } from '../commercial/invitation-tokens.js'
import { WORKER_EFFECT_TIMEOUT_MS, type EffectRequest } from './internal-effect-protocol.js'

/** The child gets only what it needs to find Python/Docker; control-plane secrets (service keys, database URL) never leak into it. */
export function buildEffectEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && (name === 'PATH' || name === 'HOME' || name === 'TMPDIR' || name === 'LANG' || /^(LC_|PYTHON|DOCKER_)/.test(name) || ['LIWAN_RELEASE_ROUTES_DIR', 'LIWAN_RELEASE_HELPER_POOL_ID'].includes(name))) out[name] = value
  }
  out.PYTHONUNBUFFERED = '1'
  return out
}

/** A child that ignores SIGTERM is SIGKILLed after this long and the request is failed regardless. */
export const KILL_GRACE_MS = 5000

const allowed = new Set(['user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed'])

/**
 * Runs one tools/shared_saas_lifecycle effect module as a child process: the request goes in through stdin only,
 * one JSON line comes back. Only an `allowedCodes` refusal reaches the caller by name; anything else is `script_failed`.
 * SIGTERM first; a child that ignores it is SIGKILLed after the grace period and the request is failed regardless.
 */
export function runEffectChild(input: { config: Config; spawnChild: typeof spawn; module: string; request: unknown; signal: AbortSignal; allowedCodes: ReadonlySet<string>; timeoutMs?: number; killGraceMs?: number }): Promise<unknown> {
  const { config, spawnChild, signal, allowedCodes } = input
  return new Promise<unknown>((resolve, reject) => {
    const child = spawnChild(config.python, ['-B', '-m', input.module],
      { cwd: config.repositoryRoot, stdio: ['pipe', 'pipe', 'ignore'], env: buildEffectEnv() })
    let buffer = '', bytes = 0, errorCode: string | undefined, settled = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort)
      try { fn() } finally { buffer = '' }
    }
    const fail = (code = 'script_failed') => {
      errorCode ??= code
      if (settled) return
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => { child.kill('SIGKILL'); finish(() => reject(Error(errorCode))) }, input.killGraceMs ?? KILL_GRACE_MS)
    }
    const abort = () => fail()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => fail(), input.timeoutMs ?? WORKER_EFFECT_TIMEOUT_MS)
    child.on('error', () => fail()); child.stdin.on('error', () => fail())
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 65536) { buffer = ''; fail(); return }
      if (!errorCode) buffer += String(chunk)
    })
    child.on('close', code => {
      finish(() => {
        try {
          if (errorCode) throw Error(errorCode)
          const message = JSON.parse(buffer)
          if (message && Object.keys(message).length === 1 && typeof message.error_code === 'string')
            throw Error(allowedCodes.has(message.error_code) ? message.error_code : 'script_failed')
          if (code !== 0 || !message || Object.keys(message).length !== 1 || !Object.hasOwn(message, 'result')) throw Error('script_failed')
          resolve(message.result)
        } catch (e) {
          reject(Error(e instanceof Error && allowedCodes.has(e.message) ? e.message : 'script_failed'))
        }
      })
    })
    // Neither spawn argv/environment nor logs contain the request.
    child.stdin.end(JSON.stringify(input.request) + '\n')
    if (signal.aborted) fail()
  })
}

/** Runs tools/shared_saas_lifecycle/admin_password_effect.py for one accepted invitation.
 * The password reaches the child through stdin only; argv, environment and logs never carry it.
 * Authority is the provisioned onboarding/active route AND a still-open invitation for the same
 * tenant and login (the token is hashed for the lookup, never stored or forwarded). */
export function createAdminPasswordRunner(pool: Pool, config: Config, runtime: unknown, spawnChild: typeof spawn = spawn, opts: { timeoutMs?: number; killGraceMs?: number } = {}) {
  return async (input: EffectRequest, signal: AbortSignal): Promise<unknown> => {
    // Accepted invitation identity is still checked against the provisioned
    // onboarding and active route; never resolve a caller-supplied database.
    const rows = await pool.query(`SELECT b.database_name,b.host,b.tenant_id AS "tenantId",b.filestore,b.registry_revision::float8 AS "registryRevision" FROM shared_registry_bindings b
      JOIN shared_onboardings o ON o.control_tenant_id=b.control_tenant_id AND o.database_name=b.database_name AND o.host=b.host
      JOIN tenants t ON t.id=b.control_tenant_id
      WHERE b.control_tenant_id=$1 AND b.enabled=true AND o.stage='active' AND o.admin_login=$2
        AND t.commercial_mode='saas' AND t.status='active'`, [input.tenant_id, input.admin_login])
    if (rows.rowCount !== 1) throw Error('user_missing')
    const invitation = await pool.query(`SELECT 1 FROM admin_invitations WHERE token_hash=$1 AND tenant_id=$2 AND admin_login=$3
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()`, [hashToken(input.token), input.tenant_id, input.admin_login])
    if (invitation.rowCount !== 1) throw Error('user_missing')
    if (signal.aborted) throw Error('script_failed')
    return runEffectChild({ config, spawnChild, module: 'tools.shared_saas_lifecycle.admin_password_effect', signal, allowedCodes: allowed, ...opts,
      request: { action: 'set_admin_password', tenant: { database: rows.rows[0].database_name, host: rows.rows[0].host },
        releaseBinding: { tenantId: rows.rows[0].tenantId, database: rows.rows[0].database_name, filestore: rows.rows[0].filestore, registryRevision: rows.rows[0].registryRevision }, login: input.admin_login, password: input.password, config: runtime } })
  }
}
