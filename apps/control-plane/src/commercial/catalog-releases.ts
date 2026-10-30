import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { catalogApplicationsFromSolution, catalogDigest } from '@liwan/commercial-contracts/server'
import { catalogReleaseViewSchema, type CatalogReleaseView } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { audit, CommercialHttpError, iso, type CommercialActor } from './lifecycle.js'

function view(row: Record<string, any>): CatalogReleaseView {
  return catalogReleaseViewSchema.parse({
    id: row.id, version: row.catalog_version, source_digest: row.source_digest, artifact_digest: row.artifact_digest,
    base_modules: row.base_modules, applications: row.applications, created_at: iso(row.created_at),
  })
}
export async function listReleases(pool: Pool) {
  const r = await pool.query('SELECT * FROM catalog_releases ORDER BY created_at DESC,id')
  return { items: r.rows.map(view), total: r.rowCount ?? 0 }
}
export async function getRelease(pool: Pool | { query: Pool['query'] }, id: string) {
  const r = await pool.query('SELECT * FROM catalog_releases WHERE id=$1', [id])
  if (!r.rowCount) throw new CommercialHttpError('release_missing', 404)
  return view(r.rows[0])
}
const ZERO = '00000000-0000-4000-8000-000000000000'
export async function createRelease(pool: Pool, actor: CommercialActor, input: { catalog_version: string; reason: string }) {
  return transaction(pool, async client => {
    const existing = await client.query('SELECT * FROM catalog_releases WHERE catalog_version=$1', [input.catalog_version])
    if (existing.rowCount) return { created: false, release: view(existing.rows[0]) }
    const src = await client.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE", [input.catalog_version])
    if (!src.rowCount) throw new CommercialHttpError('published_catalog_missing', 422, 'catalog_version')
    const { source_sha256, solution } = src.rows[0]
    const applications = catalogApplicationsFromSolution(solution, input.catalog_version)
    const base_modules = [...new Set<string>(solution.base_modules ?? [])].sort()
    // Deterministic artifact digest over normalized content, independent of the row id.
    const artifact = catalogDigest({ id: ZERO, version: input.catalog_version, source_digest: source_sha256, artifact_digest: source_sha256, base_modules, applications })
    const id = randomUUID()
    const ins = await client.query(`INSERT INTO catalog_releases(id,catalog_version,applications,base_modules,source_digest,artifact_digest)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(catalog_version) DO NOTHING RETURNING *`,
      [id, input.catalog_version, JSON.stringify(applications), JSON.stringify(base_modules), source_sha256, artifact])
    if (!ins.rowCount) {
      const again = await client.query('SELECT * FROM catalog_releases WHERE catalog_version=$1', [input.catalog_version])
      return { created: false, release: view(again.rows[0]) }
    }
    await audit(client, actor, 'catalog_release.created', id, input.reason, { catalog_version: input.catalog_version, artifact_digest: artifact })
    return { created: true, release: view(ins.rows[0]) }
  })
}
