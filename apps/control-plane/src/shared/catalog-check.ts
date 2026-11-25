import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** The trusted repository check refused the catalog; import stores nothing and publish refuses with `catalog_invalid`. */
export class CatalogCheckError extends Error {
  readonly code = 'catalog_invalid'
  constructor(reason: string) { super(`catalog check failed: ${reason}`); this.name = 'CatalogCheckError' }
}

/** One command for both paths: a catalog is imported, and published, only after this repository check passes. */
export async function runCatalogCheck({ python, repositoryRoot }: { python: string; repositoryRoot: string }): Promise<void> {
  try {
    await exec(python, ['-B', join(repositoryRoot, 'tools/catalog_check.py'), '--root', repositoryRoot], { cwd: repositoryRoot, timeout: 60000, maxBuffer: 65536 })
  } catch (error) {
    throw new CatalogCheckError(refusalOf(error))
  }
}

/** The checker names the refusal on stderr (`CATALOG_INVALID ...`); that line is the reason the operator sees. */
function refusalOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'catalog_check.py could not run'
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown }
  const output = String(stderr ?? '').trim() || String(stdout ?? '').trim()
  return output.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? 'catalog_check.py could not run'
}
