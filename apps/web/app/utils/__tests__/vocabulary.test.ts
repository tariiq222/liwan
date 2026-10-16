import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const load = (locale: string, file: string) => JSON.parse(readFileSync(resolve(root, `i18n/locales/${locale}/${file}.json`), 'utf8'))
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}
// Every locale file a customer sees.
const CUSTOMER_FILES = readdirSync(resolve(root, 'i18n/locales/en')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))

describe('owner decision O2: «باقة» is the plan, «حزمة» is never shown to a customer', () => {
  it('scans every locale file in both languages', () => {
    expect(CUSTOMER_FILES.length).toBeGreaterThan(5)
    expect(readdirSync(resolve(root, 'i18n/locales/ar')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort()).toEqual([...CUSTOMER_FILES].sort())
  })
  it('no customer string says «حزمة» or bundle/package', () => {
    const offending = CUSTOMER_FILES.flatMap(file => [
      ...strings(load('ar', file)).filter(([, v]) => /حزم/.test(v)).map(([k]) => `ar/${file}:${k}`),
      ...strings(load('en', file)).filter(([, v]) => /\b(bundle|package)s?\b/i.test(v)).map(([k]) => `en/${file}:${k}`),
    ])
    expect(offending).toEqual([])
  })
})
