import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { discoverLocaleFiles } from '@liwan/ui/i18n/localeFiles'

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
]

describe('discoverLocaleFiles', () => {
  it('returns today\'s namespace files per locale in the same order, common.json first, tolerating additional namespaces', () => {
    const files = discoverLocaleFiles(localesDir)

    for (const code of ['ar', 'en'] as const) {
      const expected = NAMESPACES.map(name => `${code}/${name}`)
      expect(files[code][0]).toBe(`${code}/common.json`)
      // Every shipped namespace is present, in the same relative order (a subsequence).
      expect(files[code].filter(file => expected.includes(file))).toEqual(expected)
      // Additional application namespaces sort by name after common.json.
      expect(files[code].slice(1)).toEqual([...files[code].slice(1)].sort())
    }
    expect(files.ar.map(file => file.slice(3))).toEqual(files.en.map(file => file.slice(3)))
  })
})
