import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocaleFiles } from '../i18n/localeFiles'

const localesDir = fileURLToPath(new URL('../i18n/locales', import.meta.url))

// The namespace set shipped before discovery; common.json first, then by name.
const NAMESPACES = [
  'common.json',
  'access.json',
  'attachments.json',
  'chat.json',
  'hr.json',
  'invite.json',
  'meetings.json',
  'notifications.json',
  'projects.json',
  'settings.json',
  'subscription.json',
  'taskLifecycle.json',
  'tasks.json',
  'vendor.json',
]

let scratch: string[] = []

function makeLocales(files: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'nasq-locales-'))
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
  it('returns the same 14 namespace files per locale as before discovery, common.json first', () => {
    const files = discoverLocaleFiles(localesDir)

    expect(files.ar).toEqual(NAMESPACES.map(name => `ar/${name}`))
    expect(files.en).toEqual(NAMESPACES.map(name => `en/${name}`))
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
