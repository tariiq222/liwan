import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const localesDir = join(appDir, '../i18n/locales')

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))))
}

const messages = (lang: string) => flatten(JSON.parse(readFileSync(join(localesDir, lang, 'adminAuth.json'), 'utf8')) as Tree)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

const usedKeys = new Set(sources(appDir).flatMap(file =>
  [...readFileSync(file, 'utf8').matchAll(/['"`](adminAuth\.[a-zA-Z.]+)['"`]/g)].map(match => match[1]!)))
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('app error messages', () => {
  it('has the same non-empty keys in both languages, including forbidden and unavailable', () => {
    const load = (lang: string) => flatten(JSON.parse(readFileSync(join(localesDir, lang, 'app.json'), 'utf8')) as Tree)
    const ar = load('ar')
    const en = load('en')
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const key of ['app.error.forbidden', 'app.error.unavailable']) {
      expect(ar[key], key).toBeTruthy()
      expect(en[key], key).toBeTruthy()
    }
  })
})

describe('adminAuth messages', () => {
  const ar = messages('ar')
  const en = messages('en')

  it('has the same keys in Arabic and English', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty text and the same placeholders in both languages', () => {
    for (const key of Object.keys(ar)) {
      expect(ar[key], key).not.toBe('')
      expect(en[key], key).not.toBe('')
      expect(placeholders(ar[key]!), key).toEqual(placeholders(en[key]!))
    }
  })

  it('defines every key the app uses', () => {
    expect([...usedKeys].filter(key => !(key in ar))).toEqual([])
  })

  it('has no key that nothing uses', () => {
    expect(Object.keys(ar).filter(key => !usedKeys.has(key))).toEqual([])
  })
})
