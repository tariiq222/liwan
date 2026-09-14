import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Components render with Nuxt UI's stock recipes. No page or story may reach
// for a custom recipe class; the z-index tokens are the one shell exception.
const webRoot = resolve(import.meta.dirname, '../../../..')
const FORBIDDEN = /nasq-ui-(?!z-)[a-z-]+|nasq-elevation-\d|data-nasq-reference-detail|--nasq-ui-progress/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') walk(full, out)
    } else if (/\.(vue|ts)$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('no custom component recipes', () => {
  it('app/ and stories/ use only Nuxt UI primitives and utilities', () => {
    const offenders = [...walk(resolve(webRoot, 'app')), ...walk(resolve(webRoot, 'stories'))]
      .filter(file => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(webRoot.length + 1))
    expect(offenders).toEqual([])
  })
})
