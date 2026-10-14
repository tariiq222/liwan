import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCatalogSource, readKnownSource } from './catalog-source.js'
import { verifyPackageSource } from '../packages.js'

const repo = join(import.meta.dirname, '../../../..')
const sha = (name: string) => createHash('sha256').update(readFileSync(join(repo, 'deploy/catalog/solutions', name))).digest('hex')
function scratch(files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'catsrc-'))
  mkdirSync(join(dir, 'deploy/catalog/solutions'), { recursive: true })
  for (const f of files) copyFileSync(join(repo, 'deploy/catalog/solutions', f), join(dir, 'deploy/catalog/solutions', f))
  return dir
}

describe('catalog source resolution by sha256', () => {
  it('resolves legacy sha to platform.json and v2 sha to platform_v2.json', async () => {
    expect((await resolveCatalogSource(repo, sha('platform.json'))).name).toBe('platform.json')
    expect((await resolveCatalogSource(repo, sha('platform_v2.json'))).name).toBe('platform_v2.json')
  })
  it('resolves the v3 sha to platform_v3.json', async () => {
    expect((await resolveCatalogSource(repo, sha('platform_v3.json'))).name).toBe('platform_v3.json')
    expect((await readKnownSource(repo, 'platform_v3.json')).name).toBe('platform_v3.json')
  })
  it('resolves the v4 operations catalog without replacing older sources', async () => {
    expect((await resolveCatalogSource(repo, sha('platform_v4.json'))).name).toBe('platform_v4.json')
    expect((await readKnownSource(repo, 'platform_v4.json')).name).toBe('platform_v4.json')
  })

  it('rejects zero matches', async () => {
    await expect(resolveCatalogSource(repo, '0'.repeat(64))).rejects.toThrow('catalog_source_unavailable')
  })
  it('rejects byte-identical duplicates as ambiguous', async () => {
    const dir = scratch(['platform.json'])
    copyFileSync(join(dir, 'deploy/catalog/solutions/platform.json'), join(dir, 'deploy/catalog/solutions/platform_v2.json'))
    await expect(resolveCatalogSource(dir, sha('platform.json'))).rejects.toThrow('catalog_source_ambiguous')
  })
  it('readKnownSource only accepts registered names', async () => {
    expect((await readKnownSource(repo)).name).toBe('platform.json')
    expect((await readKnownSource(repo, 'platform_v2.json')).name).toBe('platform_v2.json')
    await expect(readKnownSource(repo, '../../../etc/passwd')).rejects.toThrow('catalog_source_unavailable')
    await expect(readKnownSource(repo, 'other.json')).rejects.toThrow('catalog_source_unavailable')
  })
  it('verifyPackageSource verifies per version and keeps legacy rows valid', async () => {
    await expect(verifyPackageSource({ repositoryRoot: repo }, sha('platform.json'))).resolves.toBeUndefined()
    await expect(verifyPackageSource({ repositoryRoot: repo }, sha('platform_v2.json'))).resolves.toBeUndefined()
    await expect(verifyPackageSource({ repositoryRoot: repo }, 'f'.repeat(64))).rejects.toMatchObject({ code: 'package_source_mismatch' })
    const empty = mkdtempSync(join(tmpdir(), 'catsrc-empty-'))
    await expect(verifyPackageSource({ repositoryRoot: empty }, sha('platform.json'))).rejects.toMatchObject({ code: 'package_source_unavailable' })
    void writeFileSync
  })
})

import { PROVISION_ERROR_CODES } from './odoo-adapter.js'
describe('provision error_code allowlist', () => {
  it('pins every allowlisted non-secret code and excludes opaque ones', () => {
    for (const code of ['policy_script_failed', 'target_mismatch', 'policy_already_initialized', 'features_mismatch', 'modules_mismatch', 'profile_invalid', 'classification_conflict', 'snapshot_invalid', 'catalog_source_unavailable', 'catalog_source_ambiguous', 'runtime_writer_present', 'runtime_writer_after_effect']) expect(PROVISION_ERROR_CODES.has(code)).toBe(true)
    for (const code of ['shared_effect_unverified', 'Traceback (most recent call last)', 'runtime_path_invalid']) expect(PROVISION_ERROR_CODES.has(code)).toBe(false)
  })
})
