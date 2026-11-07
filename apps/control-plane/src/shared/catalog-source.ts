import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Known catalog source files, resolved by the sha256 of their bytes, never by
 * a version label or filename convention. */
export const SOLUTIONS_DIR = 'deploy/catalog/solutions'
export const KNOWN_SOURCES = ['platform.json', 'platform_v2.json', 'platform_v3.json', 'platform_v4.json'] as const
/** The one catalog a release may be published from. The earlier files stay in the tree because already-published
 * revisions are pinned to their bytes, but they are history: they predate the `sellable` flag and would publish a
 * catalog in which nothing — or, with a fallback, everything — is for sale. Pre-release rule: no parallel old paths. */
export const PUBLISHABLE_SOURCE = 'platform_v4.json' as const

export type ResolvedCatalogSource = { name: string; path: string; bytes: Buffer; sha256: string }

async function candidates(repositoryRoot: string): Promise<ResolvedCatalogSource[]> {
  const found: ResolvedCatalogSource[] = []
  for (const name of KNOWN_SOURCES) {
    const path = join(repositoryRoot, SOLUTIONS_DIR, name)
    try {
      const bytes = await readFile(path)
      found.push({ name, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
    } catch { /* an absent known source simply cannot match */ }
  }
  return found
}

/** Zero matches -> catalog_source_unavailable; byte-identical duplicates -> catalog_source_ambiguous. */
export async function resolveCatalogSource(repositoryRoot: string, sha256: string): Promise<ResolvedCatalogSource> {
  const matches = (await candidates(repositoryRoot)).filter(item => item.sha256 === sha256)
  if (matches.length > 1) throw new Error('catalog_source_ambiguous')
  if (!matches[0]) throw new Error('catalog_source_unavailable')
  return matches[0]
}
/** A stored catalog entry may move towards publication only while its bytes are still the one publishable catalog. */
export async function requirePublishableSource(repositoryRoot: string, sha256: string): Promise<ResolvedCatalogSource> {
  const source = await resolveCatalogSource(repositoryRoot, sha256)
  if (source.name !== PUBLISHABLE_SOURCE) throw new Error('catalog_source_not_publishable')
  return source
}
export async function resolveCatalogBytes(repositoryRoot: string, sha256: string): Promise<Buffer> {
  return (await resolveCatalogSource(repositoryRoot, sha256)).bytes
}

/**
 * Operator import: only the one publishable catalog, by its own name. An older file is refused rather than imported,
 * because publishing it would put a catalog for sale that predates the flag naming what is for sale.
 */
export async function readKnownSource(repositoryRoot: string, requested: string = PUBLISHABLE_SOURCE): Promise<ResolvedCatalogSource> {
  const name = basename(requested)
  if (name !== requested && requested !== join(SOLUTIONS_DIR, name)) throw new Error('catalog_source_unavailable')
  if (name !== PUBLISHABLE_SOURCE) throw new Error('catalog_source_not_publishable')
  const match = (await candidates(repositoryRoot)).find(item => item.name === name)
  if (!match) throw new Error('catalog_source_unavailable')
  return match
}
