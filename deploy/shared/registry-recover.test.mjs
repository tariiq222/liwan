import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { recoverRegistry, RecoveryRefused } from './registry-recover.mjs'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'

const target = { host: 't0.example.test', tenantId: 'tenant_0', database: 'db_0', filestore: 'db_0', enabled: true, registryRevision: 1 }
const registry = { schemaVersion: 1, snapshotRevision: 1, targets: [target] }
const tool = new URL('registry-recover.mjs', import.meta.url).pathname

function fixture({ content = JSON.stringify(registry), barrier = JSON.stringify({ snapshotRevision: 1 }), lock = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'liwan-registry-recover-'))
  const path = join(root, 'registry.json')
  writeFileSync(path, content)
  if (barrier !== null) writeFileSync(`${path}.pending`, barrier)
  if (lock) writeFileSync(`${path}.publisher-lock`, JSON.stringify({ owner: 'synthetic', pid: 1 }))
  return { root, path }
}

test('the recovery tool removes only the barrier and the publisher lock, leaving the registry bytes unchanged', () => {
  const { root, path } = fixture()
  const before = readFileSync(path)
  try {
    const plan = recoverRegistry({ registry: path })
    // No --confirm is a dry run: it reports, and changes nothing.
    assert.equal(plan.recovered, false)
    assert.equal(plan.snapshotRevision, 1)
    assert.equal(plan.targets, 1)
    assert.deepEqual(plan.removed, [])
    assert.ok(statSync(`${path}.pending`).isFile())
    assert.ok(statSync(`${path}.publisher-lock`).isFile())

    const result = recoverRegistry({ registry: path, confirm: true })
    assert.equal(result.recovered, true)
    assert.deepEqual(result.removed, [`${path}.publisher-lock`, `${path}.pending`])
    assert.throws(() => statSync(`${path}.pending`), { code: 'ENOENT' })
    assert.throws(() => statSync(`${path}.publisher-lock`), { code: 'ENOENT' })
    assert.deepEqual(readFileSync(path), before)
    // The published registry now reads normally again.
    assert.deepEqual(readTenantRegistry(path), registry)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the recovery tool removes the barrier when no publisher lock is left behind', () => {
  const { root, path } = fixture({ lock: false })
  try {
    const result = recoverRegistry({ registry: path, confirm: true })
    assert.deepEqual(result.removed, [`${path}.pending`])
    assert.equal(result.publisherLock, null)
    assert.throws(() => statSync(`${path}.pending`), { code: 'ENOENT' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the recovery tool refuses an invalid registry and changes nothing', () => {
  for (const content of ['{ not json', JSON.stringify({ schemaVersion: 2, snapshotRevision: 1, targets: [target] }), JSON.stringify({ ...registry, snapshotRevision: 0 }), JSON.stringify({ ...registry, targets: [{ ...target, database: 'other' }] })]) {
    const { root, path } = fixture({ content })
    try {
      const before = readFileSync(path)
      assert.throws(() => recoverRegistry({ registry: path, confirm: true }), error => error instanceof RecoveryRefused && error.code === 'registry_invalid')
      // A refused recovery must keep the barrier: the registry is not safe to serve.
      assert.ok(statSync(`${path}.pending`).isFile())
      assert.deepEqual(readFileSync(path), before)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('the recovery tool refuses a registry older than the interrupted publication and keeps the barrier and lock', () => {
  // A publisher that committed a tenant disable (revision 2) and died before replacing the file leaves the
  // old, still-enabled revision 1 file next to a barrier for revision 2. Clearing it would serve the tenant.
  const { root, path } = fixture({ barrier: JSON.stringify({ snapshotRevision: 2 }) })
  try {
    const before = readFileSync(path)
    for (const confirm of [false, true]) {
      assert.throws(() => recoverRegistry({ registry: path, confirm }), error => error instanceof RecoveryRefused && error.code === 'registry_behind_barrier' && /revision 1/.test(error.detail) && /revision 2/.test(error.detail))
    }
    assert.ok(statSync(`${path}.pending`).isFile())
    assert.ok(statSync(`${path}.publisher-lock`).isFile())
    assert.deepEqual(readFileSync(path), before)
    // The reader keeps failing closed.
    assert.throws(() => readTenantRegistry(path), { statusCode: 503, code: 'tenant_registry_unavailable' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the recovery tool clears a barrier whose registry already carries the published revision or a newer one', () => {
  for (const [barrierRevision, registryRevision] of [[2, 2], [1, 2]]) {
    const { root, path } = fixture({
      content: JSON.stringify({ ...registry, snapshotRevision: registryRevision, targets: [{ ...target, registryRevision }] }),
      barrier: JSON.stringify({ snapshotRevision: barrierRevision }),
    })
    try {
      const result = recoverRegistry({ registry: path, confirm: true })
      assert.equal(result.recovered, true)
      assert.equal(result.barrierSnapshotRevision, barrierRevision)
      assert.throws(() => statSync(`${path}.pending`), { code: 'ENOENT' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('the recovery tool refuses a barrier that does not record the revision it was publishing', () => {
  for (const barrier of ['registry publication pending\n', '', '{"snapshotRevision":', '[]', 'null', '{}', '{"snapshotRevision":0}', '{"snapshotRevision":1.5}', '{"snapshotRevision":"1"}', '{"snapshotRevision":1,"extra":true}']) {
    const { root, path } = fixture({ barrier })
    try {
      assert.throws(() => recoverRegistry({ registry: path, confirm: true }), error => error instanceof RecoveryRefused && error.code === 'barrier_unverifiable', `barrier ${JSON.stringify(barrier)}`)
      assert.ok(statSync(`${path}.pending`).isFile())
      assert.ok(statSync(`${path}.publisher-lock`).isFile())
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('the recovery tool refuses a missing or non-regular barrier and a relative path', () => {
  const missingBarrier = fixture({ barrier: null })
  try {
    assert.throws(() => recoverRegistry({ registry: missingBarrier.path, confirm: true }), error => error.code === 'barrier_missing')
  } finally { rmSync(missingBarrier.root, { recursive: true, force: true }) }

  const danglingBarrier = fixture({ barrier: null })
  try {
    symlinkSync(join(danglingBarrier.root, 'missing-target'), `${danglingBarrier.path}.pending`)
    assert.throws(() => recoverRegistry({ registry: danglingBarrier.path, confirm: true }), error => error.code === 'barrier_invalid')
  } finally { rmSync(danglingBarrier.root, { recursive: true, force: true }) }

  const { root, path } = fixture()
  try {
    assert.throws(() => recoverRegistry({ registry: 'registry.json', confirm: true }), error => error.code === 'registry_path_not_absolute')
    assert.throws(() => recoverRegistry({ registry: path, confirm: 'yes' }), error => error.code === 'invalid_confirm')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the CLI defaults to a dry run, requires --confirm to remove files, and reports refusals with a non-zero exit', () => {
  const { root, path } = fixture()
  try {
    const dry = spawnSync(process.execPath, [tool, '--registry', path], { encoding: 'utf8' })
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /dry run/)
    assert.match(dry.stdout, /the registry JSON is not modified/)
    assert.ok(statSync(`${path}.pending`).isFile())

    const confirmed = spawnSync(process.execPath, [tool, '--registry', path, '--confirm'], { encoding: 'utf8' })
    assert.equal(confirmed.status, 0, confirmed.stderr)
    assert.match(confirmed.stdout, new RegExp(`removed: ${path.replaceAll('.', '\\.')}\\.publisher-lock`))
    assert.match(confirmed.stdout, new RegExp(`removed: ${path.replaceAll('.', '\\.')}\\.pending`))
    assert.throws(() => statSync(`${path}.pending`), { code: 'ENOENT' })

    // Nothing to recover now: a second run refuses instead of claiming a recovery.
    const again = spawnSync(process.execPath, [tool, '--registry', path, '--confirm'], { encoding: 'utf8' })
    assert.equal(again.status, 1)
    assert.match(again.stderr, /barrier_missing/)

    const usage = spawnSync(process.execPath, [tool], { encoding: 'utf8' })
    assert.equal(usage.status, 2)
    assert.match(usage.stderr, /--registry/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a boot with a publication barrier names it and the recovery command, then exits non-zero', () => {
  const { root, path } = fixture({ lock: false })
  try {
    const start = spawnSync(process.execPath, [new URL('start.mjs', import.meta.url).pathname], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LIWAN_TENANCY_MODE: 'shared',
        LIWAN_SHARED_PROXY_TOKEN: 'synthetic-boot-token-'.repeat(3),
        LIWAN_TENANT_REGISTRY_PATH: path,
        LIWAN_GUARD_ODOO_URL: 'http://127.0.0.1:1',
        LIWAN_GUARD_WEB_URL: 'http://127.0.0.1:2',
        LIWAN_SESSION_KEYS: '{}',
        LIWAN_SESSION_ACTIVE_KID: 'test',
      },
    })
    assert.equal(start.status, 1)
    // One clear operational line, not an uncaught stack trace.
    assert.match(start.stderr, /tenant_registry_unavailable/)
    assert.ok(start.stderr.includes(`${path}.pending`), start.stderr)
    assert.match(start.stderr, /stop every registry publisher/)
    assert.ok(start.stderr.includes(`deploy/shared/registry-recover.mjs --registry ${path} --confirm`), start.stderr)
    assert.doesNotMatch(start.stderr, /\n\s+at /)
    assert.equal(start.stdout, '')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the CLI refuses a stale registry with a non-zero exit, names the control plane recovery and keeps the barrier', () => {
  const { root, path } = fixture({ barrier: JSON.stringify({ snapshotRevision: 2 }) })
  try {
    for (const flags of [[], ['--confirm']]) {
      const result = spawnSync(process.execPath, [tool, '--registry', path, ...flags], { encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /registry_behind_barrier/)
      assert.match(result.stderr, /POST \/v1\/registry\/recover/)
      assert.doesNotMatch(result.stdout, /removed:|recovered:/)
      assert.ok(statSync(`${path}.pending`).isFile())
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the CLI refuses an invalid registry with a non-zero exit and keeps the barrier', () => {
  const { root, path } = fixture({ content: '{ not json' })
  try {
    const result = spawnSync(process.execPath, [tool, '--registry', path, '--confirm'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /registry_invalid/)
    assert.ok(statSync(`${path}.pending`).isFile())
  } finally { rmSync(root, { recursive: true, force: true }) }
})
