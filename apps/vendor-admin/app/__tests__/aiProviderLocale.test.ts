import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_TEST_FAILURES } from '@liwan/commercial-contracts'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const localesDir = join(appDir, '../i18n/locales')

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))))
}
const messages = (lang: string) => flatten(JSON.parse(readFileSync(join(localesDir, lang, 'aiProvider.json'), 'utf8')) as Tree)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}
const text = sources(appDir).map(file => readFileSync(file, 'utf8')).join('\n')
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('AI provider messages', () => {
  const ar = messages('ar')
  const en = messages('en')

  it('has the same keys and placeholders in Arabic and English, none empty', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(ar)) {
      expect(ar[key], key).not.toBe('')
      expect(placeholders(ar[key]!), key).toEqual(placeholders(en[key]!))
    }
  })

  it('names every test failure the control plane can answer', () => {
    for (const code of AI_PROVIDER_TEST_FAILURES) expect(ar[`aiProvider.test.${code}`] && en[`aiProvider.test.${code}`], code).toBeTruthy()
  })

  it('uses every key it ships, written in full or built from a documented family', () => {
    const families = ['aiProvider.test.', 'aiProvider.errors.', 'aiProvider.current.delivery.']
    const unused = Object.keys(en).filter(key => !text.includes(`'${key}'`) && !text.includes(`\`${key}\``) && !families.some(family => key.startsWith(family)))
    expect(unused).toEqual([])
    for (const key of [...text.matchAll(/\bt\(\s*'(aiProvider\.[A-Za-z0-9_.]+)'/g)].map(match => match[1]!)) expect(en[key], key).toBeTypeOf('string')
  })
})
