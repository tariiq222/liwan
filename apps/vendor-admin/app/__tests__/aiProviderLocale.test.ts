import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_CAPABILITIES, AI_PROVIDER_TEST_FAILURES, AI_QUALITY_LEVELS } from '@liwan/commercial-contracts'

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

  it('names every capability, quality level and delivery state the control plane can answer', () => {
    for (const capability of AI_CAPABILITIES) expect(ar[`aiProvider.routes.capability.${capability}`] && en[`aiProvider.routes.capability.${capability}`], capability).toBeTruthy()
    for (const quality of AI_QUALITY_LEVELS) expect(ar[`aiProvider.routes.quality.${quality}`] && en[`aiProvider.routes.quality.${quality}`], quality).toBeTruthy()
    for (const state of ['delivered', 'pending', 'unconfigured', 'incomplete']) expect(ar[`aiProvider.status.delivery.${state}`] && en[`aiProvider.status.delivery.${state}`], state).toBeTruthy()
    for (const code of ['unknown_provider', 'unknown_model', 'model_not_priced', 'model_not_tested']) expect(ar[`aiProvider.errors.${code}`] && en[`aiProvider.errors.${code}`], code).toBeTruthy()
  })

  it('uses every key it ships, written in full or built from a documented family', () => {
    const families = [
      'aiProvider.test.', 'aiProvider.errors.', 'aiProvider.status.delivery.', 'aiProvider.models.reason.', 'aiProvider.save.blockers.', 'aiProvider.idProblem.',
      'aiProvider.routes.capability.', 'aiProvider.routes.quality.', 'aiProvider.models.input_price', 'aiProvider.models.cached_input_price', 'aiProvider.models.output_price',
    ]
    const unused = Object.keys(en).filter(key => !text.includes(`'${key}'`) && !text.includes(`\`${key}\``) && !families.some(family => key.startsWith(family)))
    expect(unused).toEqual([])
    for (const key of [...text.matchAll(/\bt\(\s*'(aiProvider\.[A-Za-z0-9_.]+)'/g)].map(match => match[1]!)) expect(en[key], key).toBeTypeOf('string')
  })
})
