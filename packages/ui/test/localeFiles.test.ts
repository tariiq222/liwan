import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocaleFiles } from '../i18n/localeFiles'

let scratch: string[] = []

function makeLocales(files: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'liwan-locales-'))
  scratch.push(root)
  for (const [code, names] of Object.entries(files)) {
    mkdirSync(join(root, code))
    for (const name of names) writeFileSync(join(root, code, name), '{}')
  }
  return root
}

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  scratch = []
})

describe('discoverLocaleFiles', () => {
  it('puts common.json first and the other namespaces in name order', () => {
    const root = makeLocales({ ar: ['hr.json', 'common.json', 'chat.json'], en: ['chat.json', 'common.json', 'hr.json'] })

    expect(discoverLocaleFiles(root)).toEqual({
      ar: ['ar/common.json', 'ar/chat.json', 'ar/hr.json'],
      en: ['en/common.json', 'en/chat.json', 'en/hr.json'],
    })
  })

  it('ignores non-json entries in a locale folder', () => {
    const root = makeLocales({ ar: ['common.json', 'README.md'], en: ['common.json'] })

    expect(discoverLocaleFiles(root)).toEqual({ ar: ['ar/common.json'], en: ['en/common.json'] })
  })

  it('throws when ar and en do not ship the same namespace files', () => {
    const root = makeLocales({ ar: ['common.json', 'hr.json'], en: ['common.json'] })

    expect(() => discoverLocaleFiles(root)).toThrow(/missing in en: \[hr\.json\]/)
  })

  it('throws when en has a namespace that ar does not', () => {
    const root = makeLocales({ ar: ['common.json'], en: ['common.json', 'chat.json'] })

    expect(() => discoverLocaleFiles(root)).toThrow(/extra in en: \[chat\.json\]/)
  })
})
