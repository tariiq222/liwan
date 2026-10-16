import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution, catalogDigest } from '../commercial/catalog.js'
import { catalogFeatureSchema } from '../commercial/schemas.js'
import type { CatalogRelease } from '../commercial/types.js'

const legacySolution = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform.json', import.meta.url), 'utf8'))
const v2Solution = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform_v2.json', import.meta.url), 'utf8'))
const featureFields = { key: 'branches.extra_limit', selectable: false, requires: [], enforcement_refs: [] }
const release = (solution: unknown): CatalogRelease => ({
  id: '00000000-0000-4000-8000-000000000001', version: 'v1', source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64),
  applications: catalogApplicationsFromSolution(solution as never, 'v1'),
})

describe('catalog feature ceilings', () => {
  it('preserves an optional zero ceiling and rejects invalid bounds, types, and boolean ceilings', () => {
    expect(catalogFeatureSchema.parse({ ...featureFields, kind: 'limit', ceiling: 0 })).toMatchObject({ kind: 'limit', ceiling: 0 })
    expect(catalogFeatureSchema.parse({ ...featureFields, kind: 'limit' })).not.toHaveProperty('ceiling')
    for (const ceiling of [-1, 1_000_000_001, 1.5, '0', true]) {
      expect(catalogFeatureSchema.safeParse({ ...featureFields, kind: 'limit', ceiling }).success).toBe(false)
    }
    expect(catalogFeatureSchema.safeParse({ ...featureFields, kind: 'boolean', ceiling: 0 }).success).toBe(false)
  })

  it('gives distinct canonical digests to distinct numeric ceilings', () => {
    const zero = release(v2Solution)
    const sevenSolution = structuredClone(v2Solution)
    sevenSolution.tiers[0].features[2] = 'limit:branches.extra_limit:7'
    expect(catalogDigest(zero)).not.toBe(catalogDigest(release(sevenSolution)))
  })

  it('keeps the legacy fieldless artifact digest unchanged', () => {
    const parsed = catalogFeatureSchema.parse({ ...featureFields, kind: 'limit' })
    expect(parsed).not.toHaveProperty('ceiling')
    expect(catalogDigest(release(legacySolution))).toBe('1e0581a108fd9c03e96a71ff1d2d2beaea22a8dde8499770e07c60714a1e3ca3')
  })
})
