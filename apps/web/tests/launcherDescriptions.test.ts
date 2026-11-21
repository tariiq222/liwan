import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appManifests } from '../app/modules/manifests'

type Json = Record<string, unknown>
const load = (code: string, file: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${code}/${file}`, import.meta.url)), 'utf8'))

const leaves = (node: unknown, path = ''): Record<string, string> => {
  if (typeof node === 'string') return { [path]: node }
  if (!node || typeof node !== 'object') return {}
  return Object.entries(node as Json).reduce<Record<string, string>>(
    (all, [key, value]) => ({ ...all, ...leaves(value, path ? `${path}.${key}` : key) }), {})
}

// Every launcher card reads `launcher.apps.<id>.description` in the page header tagline, in the /apps row and in the
// home rail. A missing one leaves the card with no line at all, which is how four paid applications shipped
// undescribed. The ids are derived from the manifests, not listed here: a new application with a rail entry is covered
// the moment its manifest declares one, so this test cannot go stale. The card id is the rail id, except that the
// `pmo` manifest renders the `projects` card; `payments` has no rail entry and no card.
const CARD_IDS: Readonly<Record<string, string>> = { pmo: 'projects' }
const DESCRIBED = appManifests
  .filter(manifest => manifest.rail.length > 0)
  .map(manifest => CARD_IDS[manifest.id] ?? manifest.id)

describe.each(['ar', 'en'] as const)('launcher application descriptions (%s)', code => {
  const ar = leaves(load(code, 'common.json'))
  const en = leaves(load('en', 'common.json'))
  const other = code === 'ar' ? en : leaves(load('ar', 'common.json'))

  it('describes every application that renders a launcher card', () => {
    const missing = DESCRIBED.filter(id => !ar[`launcher.apps.${id}.description`]?.trim())
    expect(missing).toEqual([])
  })

  it('has the same launcher keys in both locales', () => {
    const keys = (node: Record<string, string>) => Object.keys(node).filter(key => key.startsWith('launcher.apps.')).sort()
    expect(keys(ar)).toEqual(keys(other))
  })

  it('names real work in the HR line rather than a directory only', () => {
    const hr = ar['launcher.apps.hr.description'] ?? ''
    // Payroll and leave are the two things the old line left out; the card is the only place a new
    // administrator learns the application holds them.
    expect(hr).toMatch(code === 'ar' ? /رواتب/i : /payroll/i)
    expect(hr).toMatch(code === 'ar' ? /إجاز/ : /leave/i)
  })
})
