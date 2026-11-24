import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { createTenantStorageRunner, TENANT_STORAGE_ERROR_CODES } from '../shared/tenant-storage-runner.js'
import { EFFECT_NAMES } from '../shared/effect-channel.js'

const config = { python: 'python3', repositoryRoot: '/repo' } as Config
const binding = { database_name: 'liwan_scratch_' + 'a'.repeat(32), tenantId: 'acme', filestore: 'acme', registryRevision: 4 }
const poolWith = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rowCount: rows.length, rows })) }) as unknown as Pool & { query: ReturnType<typeof vi.fn> }
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: EventEmitter; kill: ReturnType<typeof vi.fn> }
  child.stdin = new PassThrough(); child.stdout = new EventEmitter(); child.kill = vi.fn()
  return child
}
const tenant_id = '11111111-1111-4111-8111-111111111111'
const request_id = '687674dc-5789-4a99-b151-12d69f010cc3'
const input = (operation: 'ensure' | 'verify' | 'rotate' = 'ensure') => ({ tenant_id, operation, request_id, signal: new AbortController().signal })

describe('tenant storage runner', () => {
  it('is a name the effect channel knows', () => {
    expect(EFFECT_NAMES).toContain('tenant_storage_effect')
  })
  it('sends the registry binding, never a resource name, through stdin only and resolves the effect result', async () => {
    const child = fakeChild(); const spawnChild = vi.fn(() => child); const pool = poolWith([binding])
    const stdin: string[] = []; child.stdin.on('data', c => stdin.push(String(c)))
    const result = createTenantStorageRunner(pool, config, { deps: { spawnChild: spawnChild as never } })(input('verify'))
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalled())
    expect(spawnChild.mock.calls[0]).toMatchObject({ 0: 'python3', 1: ['-E', '-s', '-B', '-m', 'tools.shared_saas_lifecycle.effect_gate'] })
    const answer = { operation: 'verify', tenantId: 'acme', requestId: request_id, state: 'pending_key', stage: 'key_stored', retryAfterSeconds: 120 }
    child.stdout.emit('data', JSON.stringify({ result: answer }) + '\n{"exit":0}\n'); child.emit('close', 0)
    expect(await result).toEqual(answer)
    const [header, request] = stdin.join('').split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(header).toEqual({ effect: 'tenant_storage_effect' })
    expect(request).toEqual({ schemaVersion: 1, operation: 'verify', tenantId: 'acme', database: binding.database_name, requestId: request_id,
      releaseBinding: { tenantId: 'acme', database: binding.database_name, filestore: 'acme', registryRevision: 4 } })
    expect(pool.query.mock.calls[0]![1]).toEqual([tenant_id])
    expect(String(pool.query.mock.calls[0]![0])).toMatch(/b\.enabled=true AND t\.commercial_mode='saas'/)
  })
  it('refuses a tenant without exactly one enabled binding before spawning anything', async () => {
    for (const rows of [[], [binding, binding]]) {
      const spawnChild = vi.fn()
      await expect(createTenantStorageRunner(poolWith(rows), config, { deps: { spawnChild: spawnChild as never } })(input())).rejects.toThrow('tenant_binding_mismatch')
      expect(spawnChild).not.toHaveBeenCalled()
    }
  })
  it('passes every named refusal of the effect through and hides any other error text', async () => {
    for (const code of [...TENANT_STORAGE_ERROR_CODES, 'private /var/lib detail']) {
      const child = fakeChild()
      const run = createTenantStorageRunner(poolWith([binding]), config, { deps: { spawnChild: vi.fn(() => child) as never } })(input()).then(() => null, e => e as Error)
      await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0))
      child.stdout.emit('data', JSON.stringify({ error_code: code }) + '\n{"exit":1}\n'); child.emit('close', 1)
      expect((await run)?.message).toBe(TENANT_STORAGE_ERROR_CODES.has(code) ? code : 'script_failed')
    }
  })
  it('covers every refusal code the Python effect can answer', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../../../../tools/shared_saas_lifecycle/tenant_storage_effect.py', import.meta.url), 'utf8')
    const declared = ['FAILURE_CODES', 'EFFECT_CODES'].flatMap(name => [...(source.match(new RegExp(`${name} = frozenset\\(\\{([^}]*)\\}\\)`, 's'))![1]!).matchAll(/'([a-z_]+)'/g)].map(m => m[1]!))
    expect(declared.length).toBeGreaterThan(8)
    expect(declared.filter(code => !TENANT_STORAGE_ERROR_CODES.has(code))).toEqual([])
  })
})
