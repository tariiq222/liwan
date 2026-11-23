import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The restore-registry directory of a prepared host belongs to the effect account (init-host.sh): the worker cannot chmod it.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    chmod: vi.fn(async (path, mode) => {
      if (String(path).endsWith('restore-registry')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      return actual.chmod(path, mode)
    }),
  }
})

const { realRestoreHost, writeRestoreRoute } = await import('../shared/odoo-backup.ts')
const approval = '687674dc-5789-4a99-b151-12d69f010cc3'
const database = 'liwan_scratch_' + 'a'.repeat(32)

test('a route is written into an existing restore directory the process cannot chmod, and the file keeps its explicit mode', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-restore-existing-')))
  mkdirSync(join(dir, 'restore-registry'), { mode: 0o775 })
  const previous = process.umask(0o077)
  try {
    await writeRestoreRoute(dir, approval, realRestoreHost(approval, 'saas.accept.liwan.test'), database)
  } finally {
    process.umask(previous)
  }
  const file = join(dir, 'restore-registry', 'registry.json')
  assert.equal(statSync(file).mode & 0o777, 0o644)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).targets.length, 1)
})
