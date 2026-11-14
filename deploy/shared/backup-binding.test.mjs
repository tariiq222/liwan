import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESOLVER = fileURLToPath(new URL('./backup-binding.mjs', import.meta.url))
const base = { schemaVersion: 1, registryRevision: 1 }
const targets = [
  { host: 'live.example.test', tenantId: 'live', database: 'liwan_live', filestore: 'liwan_live', enabled: true, registryRevision: 1 },
  { host: 'paused.example.test', tenantId: 'paused', database: 'liwan_paused', filestore: 'liwan_paused', enabled: false, registryRevision: 1 },
  { host: 'gone.example.test', tenantId: 'gone', database: 'liwan_gone', filestore: 'liwan_gone', enabled: false, retired: true, registryRevision: 2 },
]

function resolve(tenantId) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-binding-'))
  try {
    const path = join(dir, 'registry.json')
    writeFileSync(path, JSON.stringify({ ...base, snapshotRevision: 1, targets }))
    const result = spawnSync('node', [RESOLVER, path, tenantId], { encoding: 'utf8' })
    return { status: result.status, out: result.stdout ? JSON.parse(result.stdout) : null }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('an enabled tenant resolves as not retired, and a target without the field behaves the same', () => {
  assert.deepEqual(resolve('live'), { status: 0, out: { database: 'liwan_live', filestore: 'liwan_live', retired: false } })
})

test('a suspended tenant still resolves, so it keeps being backed up', () => {
  assert.deepEqual(resolve('paused'), { status: 0, out: { database: 'liwan_paused', filestore: 'liwan_paused', retired: false } })
})

test('a retired tenant resolves and is marked retired for the pipeline to refuse', () => {
  assert.deepEqual(resolve('gone'), { status: 0, out: { database: 'liwan_gone', filestore: 'liwan_gone', retired: true } })
})

test('an unbound tenant exits 2 with no output', () => {
  assert.deepEqual(resolve('nobody'), { status: 2, out: null })
})
