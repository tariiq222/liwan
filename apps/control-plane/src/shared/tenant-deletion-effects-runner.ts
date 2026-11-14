import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Config } from '../config.js'
import type { AssertOwned, DeletionEffects, DropStage } from '../commercial/tenant-deletion-effects.js'
import { planDigestOf, type EffectPlan } from '../commercial/tenant-deletion-plan.js'
import { buildEffectEnv, KILL_GRACE_MS } from './admin-password-runner.js'
import type { SharedRuntimeConfig } from './runtime-config.js'

/** Refusal codes of the drop effect that may reach the ledger by name; anything else is `script_failed`. They name a check, never a value. */
const CODE = /^[a-z][a-z0-9_]{2,63}$/
const DROP_TIMEOUT_MS = 30 * 60 * 1000
const HEARTBEAT_MS = 15_000
const OFFSITE_TIMEOUT_MS = 60 * 60 * 1000
const RELAY_TIMEOUT_MS = 15_000
const RELAY_TOKEN_MIN_BYTES = 32

type Child = ReturnType<typeof spawn>
type Spawner = typeof spawn

/**
 * One Python effect with the permit protocol: a `{"permit": name}` line asks the control plane to re-check that it still owns the request
 * (`assertOwned`) before the effect's first change, and `{"proceed": true}` answers. The same check runs on a heartbeat; losing it stops the child.
 */
function runPermitted(input: { spawnChild: Spawner; config: Config; module: string; request: unknown; assertOwned: AssertOwned; signal: AbortSignal; timeoutMs?: number }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child: Child = input.spawnChild(input.config.python, ['-B', '-m', input.module], { cwd: input.config.repositoryRoot, stdio: ['pipe', 'pipe', 'ignore'], env: buildEffectEnv() })
    let buffer = '', result: Record<string, unknown> | undefined, errorCode: string | undefined, failed = false, checking = false, chain: Promise<void> = Promise.resolve()
    let killTimer: NodeJS.Timeout | undefined
    const fail = (code = 'script_failed') => {
      errorCode ??= code
      if (failed) return
      failed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
    }
    const abort = () => fail('deletion_worker_stopping')
    input.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => fail('effect_timeout'), input.timeoutMs ?? DROP_TIMEOUT_MS)
    const heartbeat = setInterval(() => {
      if (checking || failed) return
      checking = true
      input.assertOwned().catch(() => fail('deletion_authority_lost')).finally(() => { checking = false })
    }, HEARTBEAT_MS)
    child.on('error', () => fail()); child.stdin?.on('error', () => fail())
    child.stdout?.on('data', chunk => {
      buffer += String(chunk)
      if (buffer.length > 65536) { buffer = ''; fail(); return }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        chain = chain.then(async () => {
          if (failed) return
          const message = JSON.parse(line)
          if (typeof message.permit === 'string') {
            if (!/^[a-z][a-z-]{2,40}$/.test(message.permit)) throw Error('shared_protocol_invalid')
            await input.assertOwned()
            if (failed || input.signal.aborted) throw Error('deletion_authority_lost')
            child.stdin?.write(JSON.stringify({ proceed: true }) + '\n')
          } else if (Object.keys(message).length === 1 && Object.hasOwn(message, 'result') && result === undefined) result = message.result
          else if (Object.keys(message).length === 1 && typeof message.error_code === 'string') fail(CODE.test(message.error_code) ? message.error_code : 'script_failed')
          else throw Error('shared_protocol_invalid')
        }).catch(error => fail(error instanceof Error && CODE.test(error.message) ? error.message : 'script_failed'))
      }
    })
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); clearInterval(heartbeat); input.signal.removeEventListener('abort', abort)
      child.stdin?.end()
      void chain.then(() => {
        if (errorCode) reject(Error(errorCode))
        else if (code !== 0 || result === undefined) reject(Error('script_failed'))
        else resolve(result)
      })
    })
    // The request goes in through stdin only; neither argv nor the environment carries it.
    child.stdin?.write(JSON.stringify(input.request) + '\n')
  })
}

/** The runtime config the drop effect accepts: exactly its keys (the release backup path stays out). */
const effectConfig = (runtime: SharedRuntimeConfig) => ({ schemaVersion: 1, projectName: runtime.projectName, composeFile: runtime.composeFile, envFile: runtime.envFile, stateDir: runtime.stateDir, domainSuffix: runtime.domainSuffix })

/** The off-site purge needs the bucket and its keys from the operator's environment, and nothing else of it. */
function offsiteEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out = buildEffectEnv(env)
  for (const [name, value] of Object.entries(env)) if (value !== undefined && /^LIWAN_BACKUP_S3_/.test(name)) out[name] = value
  return out
}

/** The TikTok relay's internal purge route needs its address and its own token (the relay's `LIWAN_TIKTOK_RELAY_TOKEN`, never the guard's token).
 * Without both the step is recorded as skipped; a value that is set but malformed is a misconfiguration and fails the step. */
function relaySettings(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
  const raw = env.LIWAN_TIKTOK_RELAY_URL, token = env.LIWAN_TIKTOK_RELAY_TOKEN
  if (!raw && !token) return null
  let url: URL
  try { url = new URL(raw ?? '') } catch { throw Error('relay_settings_invalid') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || Buffer.byteLength(token ?? '') < RELAY_TOKEN_MIN_BYTES) throw Error('relay_settings_invalid')
  return { url: url.origin + url.pathname.replace(/\/+$/, ''), token: token! }
}

export function createDeletionEffects(config: Config, runtime: SharedRuntimeConfig, signal: AbortSignal, options: { spawnChild?: Spawner; env?: NodeJS.ProcessEnv } = {}): DeletionEffects {
  const spawnChild = options.spawnChild ?? spawn
  const env = options.env ?? process.env
  return {
    stage: ({ stage, plan, planDigest, dryRun, assertOwned }) => {
      if (planDigestOf(plan) !== planDigest) throw Error('plan_digest_mismatch')
      return runPermitted({ spawnChild, config, module: 'tools.shared_saas_lifecycle.tenant_drop_effect', assertOwned, signal,
        request: { action: stage satisfies DropStage, dryRun, plan: plan satisfies EffectPlan, planDigest, config: effectConfig(runtime) } })
    },
    async purgeOffsite({ tenantId, settleSeconds, assertOwned }) {
      await assertOwned()
      const args = ['-B', 'deploy/backup_pipeline.py', 'purge', '--tenant', tenantId, '--settle-seconds', String(settleSeconds)]
      if (env.LIWAN_TENANT_DELETION_OFFSITE_STORE_ROOT) args.push('--store-root', env.LIWAN_TENANT_DELETION_OFFSITE_STORE_ROOT)
      return new Promise((resolve, reject) => {
        const child = spawnChild(config.python, args, { cwd: config.repositoryRoot, stdio: ['ignore', 'pipe', 'ignore'], env: offsiteEnv(env) })
        let out = '', settled = false
        const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); fn() }
        const abort = () => child.kill('SIGTERM')
        signal.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(() => child.kill('SIGTERM'), OFFSITE_TIMEOUT_MS)
        child.stdout?.on('data', chunk => { if (out.length < 65536) out += String(chunk) })
        child.on('error', () => done(() => reject(Error('offsite_purge_failed'))))
        child.on('close', code => done(() => {
          if (code === 3) return reject(Error('offsite_not_empty'))
          if (code !== 0) return reject(Error('offsite_purge_failed'))
          try { resolve({ state: 'empty', ...countsOnly(JSON.parse(out)) }) } catch { reject(Error('offsite_purge_failed')) }
        }))
      })
    },
    async unbindRelay({ tenantId, assertOwned }) {
      const relay = relaySettings(env)
      if (!relay) return { state: 'not_configured' }
      await assertOwned()
      let reply: Response
      try {
        reply = await fetch(`${relay.url}/internal/tiktok/tenants/${encodeURIComponent(tenantId)}`, {
          method: 'DELETE', headers: { 'x-liwan-proxy-token': relay.token }, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(RELAY_TIMEOUT_MS)]),
        })
      } catch { throw Error('relay_purge_unreachable') }
      if (reply.status !== 200) throw Error('relay_purge_failed')
      const { removed } = await reply.json().catch(() => ({})) as { removed?: unknown }
      if (typeof removed !== 'number' || !Number.isInteger(removed) || removed < 0) throw Error('relay_purge_failed')
      return { state: removed > 0 ? 'unbound' : 'absent' }
    },
    async removeBackupArtifacts(paths) {
      let removed = 0
      for (const path of paths) {
        if (!isAbsolute(path)) throw Error('artifact_path_invalid')
        await rm(path, { force: true }); removed++
      }
      return { removed }
    },
  }
}

/** Keeps only the numeric fields of the pipeline's report: counts, never a key name. */
function countsOnly(report: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (report && typeof report === 'object') for (const [key, value] of Object.entries(report)) if (typeof value === 'number' && /^[a-z_]{1,40}$/.test(key)) out[key] = value
  return out
}
