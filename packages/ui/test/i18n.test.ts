import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const webLocales = join(root, '../../apps/web/i18n/locales')
const LANGS = ['ar', 'en']
const ROOTS = ['app', 'states', 'filterCard', 'errors', 'brand', 'nav']

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
const uiMessages = (lang: string) => load(join(root, 'i18n/locales', lang, 'ui.json'))
const usedKeys = (): string[] => {
  const pattern = new RegExp(`['"\`]((?:${ROOTS.join('|')})\\.[a-zA-Z.]+)['"\`]`, 'g')
  const keys = sourceFiles(join(root, 'app')).flatMap(file => [...readFileSync(file, 'utf8').matchAll(pattern)].map(m => m[1]!))
  return [...new Set(keys)].sort()
}

describe('ui layer messages', () => {
  it('resolves every key the layer components use, in both locales', () => {
    const used = usedKeys()
    expect(used.length).toBeGreaterThan(0)
    for (const lang of LANGS) {
      const have = new Set(paths(uiMessages(lang)))
      expect(used.filter(key => !have.has(key)), lang).toEqual([])
    }
  })

  it('ships no key the layer components do not use', () => {
    const used = new Set(usedKeys())
    for (const lang of LANGS) expect(paths(uiMessages(lang)).filter(key => !used.has(key)), lang).toEqual([])
  })

  it('has the same key set in ar and en', () => {
    expect(paths(uiMessages('ar')).sort()).toEqual(paths(uiMessages('en')).sort())
  })

  it('does not repeat a key path that an apps/web locale file owns', () => {
    for (const lang of LANGS) {
      const own = new Set(paths(uiMessages(lang)))
      for (const file of readdirSync(join(webLocales, lang)).filter(name => name.endsWith('.json'))) {
        expect(paths(load(join(webLocales, lang, file))).filter(key => own.has(key)), `${lang}/${file}`).toEqual([])
      }
    }
  })
})
