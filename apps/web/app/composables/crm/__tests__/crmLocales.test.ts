import { describe, expect, it } from 'vitest'
import { CrmImportFileReasonSchema, CrmImportInvalidReasonSchema } from '@webvue/contracts'
import arCrm from '../../../../i18n/locales/ar/crm.json'
import enCrm from '../../../../i18n/locales/en/crm.json'

// A message that agrees with a term's gender has a `.m` and a `.f` variant (see `agreeKey`); one without the other
// would render a missing key for that gender.
function keys(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [path]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => keys(child, path ? `${path}.${key}` : key))
  return []
}

describe.each([['ar', arCrm], ['en', enCrm]])('%s crm locale gender variants', (_locale, messages) => {
  const all = keys(messages)
  const variants = (suffix: string) => all.filter(key => key.endsWith(`.${suffix}`)).map(key => key.slice(0, -2)).sort()

  it('has at least one gendered message', () => {
    expect(variants('m').length).toBeGreaterThan(0)
  })

  it('pairs every .m key with a .f key and every .f key with a .m key', () => {
    expect(variants('m')).toEqual(variants('f'))
  })
})

// The package is the company's own word: the messages that name it take `{term}`, never a fixed «باقة» / «plan».
describe.each([['ar', arCrm], ['en', enCrm]])('%s crm opportunity messages that name the package', (_locale, messages) => {
  const opportunities = messages.crm.opportunities as { sale: Record<string, string>; record: Record<string, string> }
  it('use the package term', () => {
    expect(opportunities.sale.packageRequired).toContain('{term}')
    expect(opportunities.record.listPrice).toContain('{term}')
  })
  it('has no key nothing reads', () => {
    expect(opportunities.sale).not.toHaveProperty('package')
  })
})

// Every machine reason of an invalid import row has a sentence in both languages; the preview never shows a code.
describe.each([['ar', arCrm], ['en', enCrm]])('%s crm import reasons', (_locale, messages) => {
  it('translates every reason the server can send', () => {
    const reasons = (messages.crm.imports as { reasons: Record<string, string> }).reasons
    expect(Object.keys(reasons).sort()).toEqual([...CrmImportInvalidReasonSchema.options].sort())
  })
})

// Every file refusal code, and nothing else, has a sentence: the client guard and the server's refusals share these keys.
describe.each([['ar', arCrm], ['en', enCrm]])('%s crm import file refusals', (_locale, messages) => {
  it('translates every file refusal code', () => {
    const file = (messages.crm.imports.errors as { file: Record<string, string> }).file
    expect(Object.keys(file).sort()).toEqual([...CrmImportFileReasonSchema.options].sort())
    expect(Object.values(file).every(Boolean)).toBe(true)
  })
})
