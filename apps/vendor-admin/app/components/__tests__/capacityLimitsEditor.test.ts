import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import { limitDraftError, MAX_LIMIT, type LimitDraft } from '../../utils/vendorCommercial'
import { pluralRules } from '../../../i18n/pluralRules'
import { loadSfc } from './sfc'

const KEY = 'projects.max_projects'
// The editor's translation call as it names the maximum: the key, then the parameters it was given.
const sfc = loadSfc('components/vendor/CapacityLimitsEditor.vue', {
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
  useHydrated: () => Vue.ref(true),
  limitDraftError,
})

const load = (lang: 'ar' | 'en') => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${lang}/vendor.json`), 'utf8'))
// The app's real translator over its two message files, narrowed the way i18n/__tests__/commercialCadence.test.ts narrows it.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { ar: load('ar'), en: load('en') } as never, pluralRules }) as unknown as {
  global: { t: (key: string, params: Record<string, unknown>) => string, locale: { value: string } }
}

/** The message under the one limit the editor shows; a server issue for that limit stands before a submit. */
async function message(limit: LimitDraft, options: { submitted?: boolean; serverError?: string } = {}) {
  const { render } = sfc.mount({
    modelValue: { [KEY]: limit }, keys: [KEY], labels: { [KEY]: 'Projects' },
    showErrors: options.submitted ?? true, serverErrors: options.serverError ? { [KEY]: options.serverError } : {},
  })
  return (await render()).captured.find(node => node.name === 'UFormField')!.attrs.error as string | undefined
}

describe('CapacityLimitsEditor', () => {
  it('names the allowed maximum when the limit is a whole number above it', async () => {
    expect(await message({ mode: 'number', value: String(MAX_LIMIT) })).toBeUndefined()
    expect(await message({ mode: 'number', value: String(MAX_LIMIT + 1) })).toBe(`vendor.pricing.limit.aboveMax {"max":${MAX_LIMIT}}`)
  })

  it('keeps its other messages: a malformed number, a choice not made, the server issue first, nothing before a submit', async () => {
    expect(await message({ mode: 'number', value: '1.5' })).toBe('vendor.pricing.limit.invalid')
    expect(await message({ mode: 'number', value: '' })).toBe('vendor.pricing.limit.invalid')
    expect(await message({ mode: '', value: '' })).toBe('vendor.pricing.limit.required')
    expect(await message({ mode: 'number', value: String(MAX_LIMIT + 1) }, { serverError: 'vendor.pricing.errors.limit_not_supported' })).toBe('vendor.pricing.errors.limit_not_supported')
    expect(await message({ mode: 'number', value: String(MAX_LIMIT + 1) }, { submitted: false })).toBeUndefined()
  })

  it.each(['ar', 'en'])('says in %s that the limit is above the allowed maximum, naming it', (lang) => {
    i18n.global.locale.value = lang
    const text = i18n.global.t('vendor.pricing.limit.aboveMax', { max: MAX_LIMIT })
    expect(text).toContain(String(MAX_LIMIT))
    expect(text).not.toContain('{max}')
  })
})
