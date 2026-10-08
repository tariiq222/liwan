import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { derivePackagePolicy, packageContentDigest } from '../packages.js'

export type SeedInput = { name: string; description: string; catalog_version: string; catalog_tier: string; limits: Record<string, number | null> }

/** Insert a published, reviewed package straight into the tables (the write service is retired).
 * The row carries the exact digest the read path recomputes, so resolvePackageAuthority accepts it. */
export async function seedPublishedPackage(pool: Pool, input: SeedInput, over: { available?: boolean; sourceSha256?: string } = {}) {
  const entry = (await pool.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published'", [input.catalog_version])).rows[0]
  const policy = derivePackagePolicy(entry.solution, input.catalog_tier, input.limits)
  const tier = entry.solution.tiers.find((t: { id: string }) => t.id === input.catalog_tier)
  const row = { id: randomUUID(), package_id: randomUUID(), version: 1, name: input.name, description: input.description, catalog_version: input.catalog_version,
    catalog_tier: input.catalog_tier, source_sha256: over.sourceSha256 ?? entry.source_sha256 as string, limits: input.limits, modules: policy.modules, features: tier.features as string[] }
  const digest = packageContentDigest(row)
  await pool.query('INSERT INTO commercial_packages(id) VALUES($1)', [row.package_id])
  await pool.query(`INSERT INTO package_revisions(id,package_id,version,name,description,status,available,catalog_version,catalog_tier,source_sha256,limits,modules,features,content_digest,validated_digest,published_at)
    VALUES($1,$2,1,$3,$4,'published',$5,$6,$7,$8,$9,$10,$11,$12,$12,now())`,
  [row.id, row.package_id, row.name, row.description, over.available ?? true, row.catalog_version, row.catalog_tier, row.source_sha256, JSON.stringify(row.limits), JSON.stringify(row.modules), JSON.stringify(row.features), digest])
  return { id: row.id, package_id: row.package_id, revision: (await pool.query('SELECT revision FROM package_revisions WHERE id=$1', [row.id])).rows[0].revision as number }
}
