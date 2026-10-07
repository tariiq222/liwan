import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Known catalog source files, resolved by the sha256 of their bytes, never by
 * a version label or filename convention. */
export const SOLUTIONS_DIR = 'deploy/catalog/solutions'
export const KNOWN_SOURCES = ['platform.json', 'platform_v2.json', 'platform_v3.json'] as const
export const LEGACY_SOURCE = KNOWN_SOURCES[0]

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
export async function resolveCatalogBytes(repositoryRoot: string, sha256: string): Promise<Buffer> {
  return (await resolveCatalogSource(repositoryRoot, sha256)).bytes
}

/** Operator import: only a registered file under deploy/catalog/solutions, by name. */
export async function readKnownSource(repositoryRoot: string, requested: string = LEGACY_SOURCE): Promise<ResolvedCatalogSource> {
  const name = basename(requested)
  if (name !== requested && requested !== join(SOLUTIONS_DIR, name)) throw new Error('catalog_source_unavailable')
  const match = (await candidates(repositoryRoot)).find(item => item.name === name)
  if (!match) throw new Error('catalog_source_unavailable')
  return match
}
