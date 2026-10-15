import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { buildEffectEnv, createAdminPasswordRunner } from '../shared/admin-password-runner.js'

const input = { tenant_id: '11111111-1111-4111-8111-111111111111', admin_login: 'admin@example.test', password: 'correct-horse-battery', token: 't'.repeat(43) }
const config = { python: 'python3', repositoryRoot: '/repo' } as Config
const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ database_name: 'db', host: 'h.test' }] })) } as unknown as Pool

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: EventEmitter; kill: ReturnType<typeof vi.fn> }
  child.stdin = new PassThrough(); child.stdout = new EventEmitter(); child.kill = vi.fn()
  return child
}
const runnerWith = (child: ReturnType<typeof fakeChild>, opts = {}) => {
  const spawnChild = vi.fn(() => child)
  return { spawnChild, run: createAdminPasswordRunner(pool, config, {}, spawnChild as never, opts) }
}
afterEach(() => vi.unstubAllEnvs())

describe('buildEffectEnv', () => {
  it('keeps only what the effect needs and drops control-plane secrets', () => {
    const env = buildEffectEnv({ PATH: '/bin', HOME: '/h', LANG: 'C', LC_ALL: 'C', PYTHONPATH: '/p', DOCKER_HOST: 'unix:///d.sock',
      INTERNAL_EFFECT_KEY: 'a', CONTROL_SERVICE_KEY: 'b', CONTROL_DATABASE_URL: 'c', CUSTOMER_COMMERCIAL_SERVICE_KEY: 'd', NODE_OPTIONS: 'x' })
    expect(Object.keys(env).sort()).toEqual(['DOCKER_HOST', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'PYTHONPATH', 'PYTHONUNBUFFERED'])
  })
  it('is what the child is spawned with', async () => {
    vi.stubEnv('INTERNAL_EFFECT_KEY', 'secret-key-value'); vi.stubEnv('CONTROL_SERVICE_KEY', 'other-secret')
    const child = fakeChild(); const { spawnChild, run } = runnerWith(child)
    const p = run(input, new AbortController().signal)
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalled())
    const options = (spawnChild.mock.calls[0] as unknown[])[2] as { env: Record<string, string> }
    expect(JSON.stringify(options.env)).not.toMatch(/secret/)
    child.stdout.emit('data', JSON.stringify({ result: { ok: 1 } })); child.emit('close', 0)
    expect(await p).toEqual({ ok: 1 })
  })
})

describe('child lifecycle', () => {
  it('rejects and SIGKILLs a child that ignores SIGTERM after the timeout', async () => {
    const child = fakeChild(); const { run } = runnerWith(child, { timeoutMs: 20, killGraceMs: 30 })
    const err = await run(input, new AbortController().signal).then(() => null, e => e as Error)
    expect(err?.message).toBe('script_failed')
    expect(child.kill.mock.calls.map(c => c[0])).toEqual(['SIGTERM', 'SIGKILL'])
  })
  it('does the same on abort', async () => {
    const child = fakeChild(); const { run } = runnerWith(child, { killGraceMs: 30 })
    const ac = new AbortController()
    const p = run(input, ac.signal).then(() => null, e => e as Error)
    await vi.waitFor(() => expect(child.stdin.writableEnded).toBe(true))
    ac.abort()
    expect((await p)?.message).toBe('script_failed')
    expect(child.kill.mock.calls.map(c => c[0])).toEqual(['SIGTERM', 'SIGKILL'])
  })
  it('does not SIGKILL a child that closes after SIGTERM', async () => {
    const child = fakeChild(); const { run } = runnerWith(child, { timeoutMs: 10, killGraceMs: 200 })
    const p = run(input, new AbortController().signal).then(() => null, e => e as Error)
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'))
    child.emit('close', null)
    expect((await p)?.message).toBe('script_failed')
    await new Promise(r => setTimeout(r, 250))
    expect(child.kill).toHaveBeenCalledTimes(1)
  })
  it('fails on output overflow', async () => {
    const child = fakeChild(); const { run } = runnerWith(child, { killGraceMs: 20 })
    const p = run(input, new AbortController().signal).then(() => null, e => e as Error)
    await vi.waitFor(() => expect(child.stdin.writableEnded).toBe(true))
    child.stdout.emit('data', 'x'.repeat(70000))
    expect((await p)?.message).toBe('script_failed')
  })
})
