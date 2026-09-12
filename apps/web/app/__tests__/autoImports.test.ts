import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Nuxt auto-imports every export under app/composables and app/utils into one
// flat namespace, and derives one component name per file under app/components.
// A name claimed twice is resolved silently: the bundler keeps one definition
// and drops the other, so a caller who relies on the auto-import can get the
// wrong implementation with no error anywhere. `nuxt prepare` only warns, and
// warnings scroll past. This scans the source the way the bundler does —
// there is no runtime API to ask for the resolved namespace.
const appRoot = join(import.meta.dirname, '..')

function sourceFiles(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(appRoot, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (path.includes('__tests__')) continue
    if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(path)
  }
  return found
}

const DECLARATION = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
const NAMED_BLOCK = /^export\s+(?:type\s+)?\{([^}]*)\}/gm

function exportedNames(source: string): string[] {
  const names: string[] = []
  for (const [, name] of source.matchAll(DECLARATION)) if (name) names.push(name)
  for (const [, block] of source.matchAll(NAMED_BLOCK)) {
    for (const clause of (block ?? '').split(',')) {
      // `export { a as b }` publishes `b`; a bare `export { a }` publishes `a`.
      const published = clause.split(/\sas\s/).pop()?.replace(/\btype\b/, '').trim()
      if (published && /^[A-Za-z_$][\w$]*$/.test(published) && published !== 'default') names.push(published)
    }
  }
  return names
}

describe('Nuxt auto-import namespace', () => {
  it('gives every auto-imported name exactly one owning file', () => {
    const owners = new Map<string, string[]>()
    for (const file of [...sourceFiles('composables', ['.ts']), ...sourceFiles('utils', ['.ts'])]) {
      for (const name of exportedNames(readFileSync(file, 'utf8'))) {
        owners.set(name, [...(owners.get(name) ?? []), relative(appRoot, file)])
      }
    }

    const collisions = [...owners.entries()]
      .filter(([, files]) => new Set(files).size > 1)
      .map(([name, files]) => `${name}: ${[...new Set(files)].sort().join(' + ')}`)
      .sort()

    expect(collisions, 'rename the symbol, or give it one owner and import it explicitly').toEqual([])
  })

  it('gives every component file a unique component name', () => {
    const owners = new Map<string, string[]>()
    for (const file of sourceFiles('components', ['.vue', '.ts'])) {
      const withoutExtension = relative(join(appRoot, 'components'), file).replace(/\.(vue|ts)$/, '')
      // Nuxt joins the directory segments and the basename, ignoring case.
      const name = withoutExtension.split(/[/\\]/).join('-').toLowerCase()
      owners.set(name, [...(owners.get(name) ?? []), relative(appRoot, file)])
    }

    const collisions = [...owners.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.sort().join(' + ')}`)
      .sort()

    expect(collisions, 'a non-component helper belongs in app/utils, not app/components').toEqual([])
  })
})
