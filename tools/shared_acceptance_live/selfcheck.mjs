// selfcheck.mjs — Validates dummy registry and session keys using the production
// parser modules (no copies). Exits non-zero on any failure.
// Run: node tools/shared_acceptance_live/selfcheck.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

// Import the real production parsers via their repo-relative paths.
// Node 24+ with --experimental-strip-types or native TS support handles .ts imports.
const { validateRegistry, readTenantRegistry } = await import(resolve(REPO_ROOT, 'apps/web/server/utils/tenantRegistry.ts'))
const { sessionCodec } = await import(resolve(REPO_ROOT, 'deploy/shared/guard.mjs'))

const TMPDIR = resolve('/tmp', `liwan-selfcheck-${Date.now()}`)
mkdirSync(TMPDIR, { recursive: true })

let failures = 0
function assert(label, fn) {
  try {
    fn()
    console.log(`  PASS: ${label}`)
  } catch (e) {
    console.error(`  FAIL: ${label}: ${e.message}`)
    failures++
  }
}

console.log('=== Registry validation ===')

// Valid dummy registry matching the schema in tenantRegistry.ts
const validRegistry = {
  schemaVersion: 1,
  snapshotRevision: 1,
  targets: [
    {
      host: 'a.accept.liwan.test',
      tenantId: 'accept-a',
      database: 'liwan_accept_a',
      filestore: 'liwan_accept_a',
      enabled: true,
      registryRevision: 1,
    },
    {
      host: 'b.accept.liwan.test',
      tenantId: 'accept-b',
      database: 'liwan_accept_b',
      filestore: 'liwan_accept_b',
      enabled: true,
      registryRevision: 1,
    },
  ],
}

assert('valid registry passes validateRegistry()', () => {
  const result = validateRegistry(validRegistry)
  if (result.schemaVersion !== 1) throw new Error('wrong schemaVersion')
  if (result.targets.length !== 2) throw new Error('wrong target count')
})

assert('readTenantRegistry reads a published snapshot', () => {
  const regPath = resolve(TMPDIR, 'registry.json')
  writeFileSync(regPath, JSON.stringify(validRegistry))
  const loaded = readTenantRegistry(regPath)
  if (loaded.targets.length !== 2) throw new Error('wrong target count')
})

assert('readTenantRegistry fails closed on an interrupted publication (.pending)', () => {
  const regPath = resolve(TMPDIR, 'registry.json')
  writeFileSync(regPath, JSON.stringify(validRegistry))
  writeFileSync(`${regPath}.pending`, '')
  try {
    readTenantRegistry(regPath)
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('tenant_registry_unavailable')) throw e
  } finally {
    rmSync(`${regPath}.pending`, { force: true })
  }
})

assert('invalid schemaVersion rejected', () => {
  try {
    validateRegistry({ ...validRegistry, schemaVersion: 2 })
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('tenant_registry_invalid')) throw e
  }
})

assert('duplicate host rejected', () => {
  try {
    validateRegistry({
      ...validRegistry,
      targets: [validRegistry.targets[0], { ...validRegistry.targets[0], tenantId: 'dup' }],
    })
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('tenant_registry_invalid')) throw e
  }
})

assert('database != filestore rejected', () => {
  try {
    validateRegistry({
      ...validRegistry,
      targets: [{ ...validRegistry.targets[0], filestore: 'different' }],
    })
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('tenant_registry_invalid')) throw e
  }
})

console.log('\n=== Session key validation ===')

// Keys must be >=32 bytes each, matching guard.mjs sessionCodec requirements
const validKeys = {
  k1: 'a'.repeat(64), // 64 hex chars = 32 bytes
  k2: 'b'.repeat(64),
}

assert('valid keys + activeKid creates codec', () => {
  const codec = sessionCodec(validKeys, 'k1')
  if (!codec.seal || !codec.open) throw new Error('missing seal/open')
})

assert('seal + open roundtrip works', () => {
  const codec = sessionCodec(validKeys, 'k1')
  const tenant = { tenantId: 'accept-a', registryRevision: 1 }
  const sealed = codec.seal('test-sid-123', tenant)
  if (typeof sealed !== 'string' || !sealed.includes('.')) throw new Error('bad seal format')
  const opened = codec.open(sealed, tenant)
  if (opened !== 'test-sid-123') throw new Error(`roundtrip failed: got ${opened}`)
})

assert('short key rejected (< 32 bytes)', () => {
  try {
    sessionCodec({ k1: 'short' }, 'k1')
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('invalid_session_keyring')) throw e
  }
})

assert('missing activeKid rejected', () => {
  try {
    sessionCodec(validKeys, 'nonexistent')
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('invalid_session_keyring')) throw e
  }
})

assert('tampered signature rejected', () => {
  const codec = sessionCodec(validKeys, 'k1')
  const tenant = { tenantId: 'accept-a', registryRevision: 1 }
  const sealed = codec.seal('test-sid', tenant)
  const parts = sealed.split('.')
  // Tamper with the signature
  parts[1] = parts[1].split('').reverse().join('')
  try {
    codec.open(parts.join('.'), tenant)
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('invalid_session')) throw e
  }
})

assert('cross-tenant cookie rejected', () => {
  const codec = sessionCodec(validKeys, 'k1')
  const tenantA = { tenantId: 'accept-a', registryRevision: 1 }
  const tenantB = { tenantId: 'accept-b', registryRevision: 1 }
  const sealed = codec.seal('test-sid', tenantA)
  try {
    codec.open(sealed, tenantB)
    throw new Error('should have thrown')
  } catch (e) {
    if (!e.message.includes('invalid_session')) throw e
  }
})

// Cleanup
rmSync(TMPDIR, { recursive: true, force: true })

console.log(`\n=== Results: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ===`)
if (failures > 0) process.exit(1)
