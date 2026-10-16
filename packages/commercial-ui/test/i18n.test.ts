import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const webLocales = join(root, '../../apps/web/i18n/locales')
const uiLocales = join(root, '../ui/i18n/locales')
const LANGS = ['ar', 'en']
const ROOT = 'commercial'

type Tree = { [key: string]: string | Tree }

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

function paths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : paths(value, `${prefix}${key}.`))
}

const load = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Tree
const messages = (lang: string) => load(join(root, 'i18n/locales', lang, 'commercial.json'))
const usedKeys = (): string[] => {
  const pattern = new RegExp(`['"\`]((?:${ROOT})\\.[a-zA-Z.]+)['"\`]`, 'g')
  const keys = sourceFiles(join(root, 'app')).flatMap(file => [...readFileSync(file, 'utf8').matchAll(pattern)].map(m => m[1]!))
  return [...new Set(keys)].sort()
}
// Keys the components build from a variable (`commercial.pricing.cadence.${unit}.one`).
const DYNAMIC = ['commercial.pricing.cadence.month.one', 'commercial.pricing.cadence.month.many', 'commercial.pricing.cadence.year.one', 'commercial.pricing.cadence.year.many']

describe('commercial-ui messages', () => {
  it('resolves every key the layer uses, in both locales', () => {
    const used = [...usedKeys(), ...DYNAMIC]
    expect(used.length).toBeGreaterThan(DYNAMIC.length)
    for (const lang of LANGS) {
      const have = new Set(paths(messages(lang)))
      expect(used.filter(key => !have.has(key)), lang).toEqual([])
    }
  })

  it('ships no key the layer does not use', () => {
    const used = new Set([...usedKeys(), ...DYNAMIC])
    for (const lang of LANGS) expect(paths(messages(lang)).filter(key => !used.has(key)), lang).toEqual([])
  })

  it('has the same key set in ar and en', () => {
    expect(paths(messages('ar')).sort()).toEqual(paths(messages('en')).sort())
  })

  it('does not repeat a key path that apps/web or the ui layer own', () => {
    for (const lang of LANGS) {
      const own = new Set(paths(messages(lang)))
      for (const dir of [join(webLocales, lang), join(uiLocales, lang)]) {
        for (const file of readdirSync(dir).filter(name => name.endsWith('.json'))) {
          expect(paths(load(join(dir, file))).filter(key => own.has(key)), `${dir}/${file}`).toEqual([])
        }
      }
    }
  })
})
