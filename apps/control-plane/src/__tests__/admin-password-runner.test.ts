import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { createAdminPasswordRunner } from '../shared/admin-password-runner.js'

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
  return { spawnChild, run: createAdminPasswordRunner(pool, config, { ...opts, deps: { spawnChild: spawnChild as never } }) }
}
/** What the gate sends: the effect's lines, then its exit status. */
const reply = (child: ReturnType<typeof fakeChild>, message: unknown, exit = 0) => child.stdout.emit('data', JSON.stringify(message) + '\n' + JSON.stringify({ exit }) + '\n')
afterEach(() => vi.unstubAllEnvs())

describe('effect request', () => {
  it('opens the gate with the effect name and the request without config, and a worker environment with no secrets', async () => {
    vi.stubEnv('INTERNAL_EFFECT_KEY', 'secret-key-value'); vi.stubEnv('CONTROL_SERVICE_KEY', 'other-secret')
    const child = fakeChild(); const { spawnChild, run } = runnerWith(child)
    const written: string[] = []; child.stdin.on('data', c => written.push(String(c)))
    const p = run(input, new AbortController().signal)
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalled())
    const [command, args, options] = spawnChild.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; detached: boolean }]
    expect(command).toBe('python3'); expect(args).toEqual(['-E', '-s', '-B', '-m', 'tools.shared_saas_lifecycle.effect_gate']); expect(options.detached).toBe(true)
    expect(JSON.stringify(options.env)).not.toMatch(/secret/)
    const [header, request] = written.join('').split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(header).toEqual({ effect: 'admin_password_effect' })
    expect(request).not.toHaveProperty('config')
    reply(child, { result: { ok: 1 } }); child.emit('close', 0)
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
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0))
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
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0))
    child.stdout.emit('data', 'x'.repeat(70000))
    expect((await p)?.message).toBe('script_failed')
  })
})
