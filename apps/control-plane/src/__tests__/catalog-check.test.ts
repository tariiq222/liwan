import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCatalogCheck } from '../shared/catalog-check.js'

// A stand-in interpreter prints exactly the lines the repository check prints, so the reported reason is tested without running the real checker.
const refusal = 'CATALOG_INVALID release module liwan_x has no readable manifest'
let dir = ''
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'catalog-check-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function interpreter(name: string, stderr: string): string {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\ncat >&2 <<'OUT'\n${stderr}\nOUT\nexit 1\n`)
  chmodSync(file, 0o755)
  return file
}

const reasonOf = (python: string) => runCatalogCheck({ python, repositoryRoot: dir }).then(() => '', (error: Error) => error.message)

describe('runCatalogCheck', () => {
  it('reports the CATALOG_INVALID line, not the traceback above it', async () => {
    const python = interpreter('python-trace', `Traceback (most recent call last):\n  File "tools/catalog_check.py", line 9, in <module>\n${refusal}`)
    expect(await reasonOf(python)).toBe(`catalog check failed: ${refusal}`)
  })

  it('falls back to the first line when the checker names no CATALOG_INVALID', async () => {
    const python = interpreter('python-plain', 'catalog_check.py: cannot read the schema directory')
    expect(await reasonOf(python)).toBe('catalog check failed: catalog_check.py: cannot read the schema directory')
  })

  it('uses the fixed message when the checker prints nothing', async () => {
    const python = interpreter('python-silent', '')
    expect(await reasonOf(python)).toBe('catalog check failed: catalog_check.py could not run')
  })
})
