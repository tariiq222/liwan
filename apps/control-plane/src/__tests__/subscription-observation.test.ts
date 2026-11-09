import { describe,expect,it,vi } from 'vitest'
import { createOdooAdapter, subscriptionObservationRequest } from '../shared/odoo-adapter.js'
describe('source subscription observation binding',()=>{
 const binding={tenantId:'tenant-a',database:'source',filestore:'source',registryRevision:1,host:'a.invalid'}
 it('keeps the exact current source binding',()=>{
  expect(subscriptionObservationRequest(binding,{database:'source'})).toMatchObject({tenant:{database:'source',host:'a.invalid'},releaseBinding:binding})
 })
 it('refuses an isolated target through the source observer before execution',()=>{
  expect(()=>subscriptionObservationRequest(binding,{database:'restore-target'})).toThrow('tenant_binding_mismatch')
  expect(()=>subscriptionObservationRequest({...binding,filestore:'other'},{database:'source'})).toThrow('tenant_binding_mismatch')
 })
})

it('the default adapter refuses a restore observation without exact target authority', async () => {
  const { mkdtemp, writeFile, realpath, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const { Pool } = await import('pg')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'liwan-restore-adapter-')))
  const pool = new Pool()
  try {
    const sharedRuntimeConfigPath = join(root, 'config.json')
    const tenantRegistryPath = join(root, 'registry.json')
    const composeFile = join(root, 'compose.yml')
    const envFile = join(root, 'runtime.env')
    await Promise.all([
      writeFile(composeFile, ''),
      writeFile(envFile, ''),
      writeFile(sharedRuntimeConfigPath, JSON.stringify({
        schemaVersion: 1, projectName: 'liwan-saas-restore-adapter',
        composeFile, envFile, stateDir: root, domainSuffix: 'local.test',
      })),
    ])
    const config = { sharedRuntimeConfigPath, tenantRegistryPath } as Parameters<typeof createOdooAdapter>[1]
    const signal = new AbortController().signal
    vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', undefined)
    const adapter = createOdooAdapter(pool, config, signal)
    expect(adapter.observeRestoreSubscription).toBeTypeOf('function')
    await expect(adapter.observeRestoreSubscription!({ tenant_id: randomUUID(), database: 'liwan_scratch_' + 'a'.repeat(32) }))
      .rejects.toThrow('shared_restore_approval_unavailable')
    vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', '/unused/release-routes')
    expect(createOdooAdapter(pool, config, signal).observeRestoreSubscription).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    await pool.end()
    await rm(root, { recursive: true, force: true })
  }
})
