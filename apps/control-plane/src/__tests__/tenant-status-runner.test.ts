import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { createTenantStatusRunner } from '../shared/tenant-status-runner.js'

const config = { python: 'python3', repositoryRoot: '/repo' } as Config
const binding = { database_name: 'liwan_scratch_' + 'a'.repeat(32), host: 'acme.liwan.test' }
const poolWith = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rowCount: rows.length, rows })) }) as unknown as Pool & { query: ReturnType<typeof vi.fn> }
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: EventEmitter; kill: ReturnType<typeof vi.fn> }
  child.stdin = new PassThrough(); child.stdout = new EventEmitter(); child.kill = vi.fn()
  return child
}
const tenant_id = '11111111-1111-4111-8111-111111111111'

describe('tenant status runner', () => {
  it('sends the registry binding and the status through stdin only, and resolves the effect result', async () => {
    const child = fakeChild(); const spawnChild = vi.fn(() => child); const pool = poolWith([binding])
    const stdin: string[] = []; child.stdin.on('data', c => stdin.push(String(c)))
    const run = createTenantStatusRunner(pool, config, new AbortController().signal, { deps: { spawnChild: spawnChild as never } })
    const result = run({ tenant_id, status: 'suspended', suspension_reason: 'non_payment' })
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalled())
    expect(spawnChild.mock.calls[0]).toMatchObject({ 0: 'python3', 1: ['-E', '-s', '-B', '-m', 'tools.shared_saas_lifecycle.effect_gate'] })
    child.stdout.emit('data', JSON.stringify({ result: { status: 'suspended' } }) + '\n{"exit":0}\n'); child.emit('close', 0)
    expect(await result).toEqual({ status: 'suspended' })
    const [header, request] = stdin.join('').split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(header).toEqual({ effect: 'tenant_status_effect' })
    expect(request).toEqual({ action: 'set_tenant_status', tenant: { database: binding.database_name, host: binding.host },
      status: 'suspended', reason: 'non_payment' })
    // The tenant comes from the control tenant id, enabled binding and saas mode only.
    expect(pool.query.mock.calls[0]![1]).toEqual([tenant_id])
    expect(String(pool.query.mock.calls[0]![0])).toMatch(/b\.enabled=true AND t\.commercial_mode='saas'/)
  })
  it('refuses a tenant without exactly one enabled binding before spawning anything', async () => {
    for (const rows of [[], [binding, binding]]) {
      const spawnChild = vi.fn()
      const run = createTenantStatusRunner(poolWith(rows), config, new AbortController().signal, { deps: { spawnChild: spawnChild as never } })
      await expect(run({ tenant_id, status: 'active', suspension_reason: null })).rejects.toThrow('tenant_binding_mismatch')
      expect(spawnChild).not.toHaveBeenCalled()
    }
  })
  it('passes a named refusal through and hides any other error text', async () => {
    for (const [code, expected] of [['profile_invalid', 'profile_invalid'], ['private /var/lib detail', 'script_failed']] as const) {
      const child = fakeChild()
      const run = createTenantStatusRunner(poolWith([binding]), config, new AbortController().signal, { deps: { spawnChild: vi.fn(() => child) as never } })
      const result = run({ tenant_id, status: 'active', suspension_reason: null }).then(() => null, e => e as Error)
      await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0))
      child.stdout.emit('data', JSON.stringify({ error_code: code }) + '\n{"exit":1}\n'); child.emit('close', 1)
      expect((await result)?.message).toBe(expected)
    }
  })
})
