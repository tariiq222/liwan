import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vendorCommercial from '../../utils/vendorCommercial'

// The mounting harness of admin-repairs.test.ts: the page's SFC script and template are compiled in place, every
// Nuxt/UI binding it resolves is injected, and the child components are shallow stubs that record their props.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))

/** The stored row: a 499.00 SAR assisted-onboarding fee next to an empty bank account. */
const settings = {
  refund_window_days: 14, onboarding_fee_minor: 49900, onboarding_currency: 'SAR', onboarding_exponent: 2,
  bank_account_name: '', bank_account_number: '', bank_iban: '', bank_instructions_ar: '', bank_instructions_en: '',
}

type Options = { settings?: Partial<typeof settings>; hydrated?: boolean; grants?: string[]; reloadFails?: boolean }

async function page(options: Options = {}) {
  const filename = resolve(import.meta.dirname, '../billing-settings.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'billing-settings-onboarding-fee' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  let loaded = { ...settings, ...options.settings }
  let saved = false
  const request = vi.fn(async (_path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (init?.method === 'PATCH' && init.body) { loaded = { ...loaded, ...init.body }; saved = true; return loaded }
    if (saved && options.reloadFails) throw { statusCode: 503, data: { code: 'vendor_unavailable' } }
    return loaded
  })
  const bindings = {
    ...vendorCommercial, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(options.hydrated ?? true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
    useVendorContext: () => ({ can: (grant: string) => (options.grants ?? ['vendor.read', 'vendor.billing.manage']).includes(grant) }),
    useVendorApi: () => ({ request }),
    useAsyncData: async (key: string | (() => string), fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { pending.value = true; try { data.value = await fn(); error.value = null } catch (e) { error.value = e } finally { pending.value = false } })
      await refresh()
      void key
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'billing-settings-onboarding-fee', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: { name: string; props: Record<string, unknown> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', { 'data-testid': attrs['data-testid'] as string | undefined }, [attrs.title as string, attrs.description as string, attrs.help as string, attrs.error as string, slots.default?.()]) }
    } }))
    return { html: await renderToString(app), captured }
  }
  /** The draft must be valid apart from the fee so each fee case proves the fee is what refuses the save. */
  const ready = () => { state.draft.reason = 'quarterly pricing review' }
  type Patch = [string, { method: 'PATCH'; body: Record<string, unknown> }]
  const patches = (): Patch[] => request.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'PATCH') as Patch[]
  /** The body of the one PATCH the test expects; throws (failing the test) when none was sent. */
  const sent = (index = 0): Record<string, unknown> => {
    const patch = patches()[index]
    if (!patch) throw new Error('no PATCH was sent')
    return patch[1].body
  }
  return { state, request, patches, sent, ready, rendered }
}

describe('billing settings onboarding fee', () => {
  it('shows the stored fee as a whole amount with the currency', async () => {
    const p = await page(); p.ready()
    expect(p.state.draft.onboarding_fee).toBe('499')
    // Loading a stored fee unchanged is valid: it is what the vendor already has, and the save omits it.
    expect(p.state.errors.value).toEqual({})
    const field = (await p.rendered()).captured.find(c => c.name === 'UFormField' && c.props.label === 'vendor.billingSettings.fields.onboardingFee')
    expect(field?.props.help).toBe('vendor.billingSettings.fields.onboardingFeeHint')
    expect(field?.props.error).toBeUndefined()
  })

  it('sends a changed fee in minor units of the returned exponent', async () => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = '750'
    await p.state.submit()
    expect(p.patches()).toEqual([['commercial/billing-settings', { method: 'PATCH', body: expect.objectContaining({ onboarding_fee_minor: 75000 }) }]])
  })

  it('accepts an explicit 0 as "no onboarding"', async () => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = '0'
    expect(p.state.errors.value).not.toHaveProperty('onboardingFee')
    await p.state.submit()
    expect(p.sent()).toMatchObject({ onboarding_fee_minor: 0 })
  })

  it.each(['-5', '1.5', 'abc'])('refuses %j with the fee message and sends nothing', async value => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = value
    await p.state.submit()
    expect(p.state.errors.value.onboardingFee).toBe('vendor.billingSettings.errors.onboardingFee')
    expect(p.patches()).toEqual([])
    expect((await p.rendered()).captured.find(c => c.name === 'UFormField' && c.props.label === 'vendor.billingSettings.fields.onboardingFee')?.props.error).toBe('vendor.billingSettings.errors.onboardingFee')
  })

  it.each(['499.00', '0.00', '1,5', '499 SAR', '٤٩٩ريال'])('refuses the non-major-unit form %j, which the stored "" field would turn into a change', async value => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = value
    expect(p.state.errors.value.onboardingFee).toBe('vendor.billingSettings.errors.onboardingFee')
    await p.state.submit()
    expect(p.patches()).toEqual([])
  })

  it('accepts Arabic-Indic digits as the same whole amount', async () => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = '٧٥٠'
    await p.state.submit()
    expect(p.sent()).toMatchObject({ onboarding_fee_minor: 75000 })
  })

  it('reverts to the stored fee when the field is blanked, keeping the change out of the PATCH', async () => {
    const p = await page(); p.ready()
    p.state.draft.onboarding_fee = '750'; await Vue.nextTick()
    p.state.draft.onboarding_fee = ''
    expect(p.state.errors.value).toEqual({})
    await p.state.submit()
    expect(p.sent()).not.toHaveProperty('onboarding_fee_minor')
  })

  it('fails closed when the row carries no exponent: the field is empty and any entry is refused', async () => {
    const p = await page({ settings: { onboarding_exponent: undefined } as never }); p.ready()
    expect(p.state.draft.onboarding_fee).toBe('')
    p.state.draft.onboarding_fee = '750'
    await Vue.nextTick()
    expect(p.state.errors.value.onboardingFee).toBe('vendor.billingSettings.errors.onboardingFee')
    await p.state.submit()
    expect(p.patches()).toEqual([])
  })

  it('keeps a stored fee with fractional riyals as it is and lets the vendor save another setting', async () => {
    const p = await page({ settings: { onboarding_fee_minor: 49950 } }); p.ready()
    expect(p.state.draft.onboarding_fee).toBe('499.50')
    // The untouched value is not judged: it would otherwise make the whole form unsaveable.
    expect(p.state.errors.value).toEqual({})
    p.state.draft.bank_account_name = 'Liwan'
    await p.state.submit()
    expect(p.sent()).toHaveProperty('bank_account_name', 'Liwan')
    expect(p.sent()).not.toHaveProperty('onboarding_fee_minor')
  })

  it('refuses a fractional fee the vendor types, and an edit of the stored one that is not a whole amount', async () => {
    const p = await page({ settings: { onboarding_fee_minor: 49950 } }); p.ready()
    p.state.draft.onboarding_fee = '499.5'
    expect(p.state.errors.value.onboardingFee).toBe('vendor.billingSettings.errors.onboardingFee')
    p.state.draft.onboarding_fee = '500'
    expect(p.state.errors.value).toEqual({})
    await p.state.submit()
    expect(p.sent()).toMatchObject({ onboarding_fee_minor: 50000 })
  })

  it('never sends the currency or the exponent the vendor did not change', async () => {
    const p = await page(); p.ready()
    p.state.draft.bank_account_name = 'Liwan'
    p.state.draft.onboarding_fee = '750'
    await p.state.submit()
    const body = p.sent()
    expect(body).not.toHaveProperty('onboarding_currency')
    expect(body).not.toHaveProperty('onboarding_exponent')
  })

  it('omits the fee from the PATCH when the vendor left it untouched', async () => {
    const p = await page(); p.ready()
    p.state.draft.bank_account_name = 'Liwan'
    expect(p.state.errors.value).toEqual({})
    const before = p.patches().length
    await p.state.submit()
    const body = p.sent(before)
    expect(body).not.toHaveProperty('onboarding_fee_minor')
    expect(body).toHaveProperty('bank_account_name', 'Liwan')
  })

  it('never puts the fee or its validation on a form without the billing grant', async () => {
    const p = await page({ grants: ['vendor.read'] }); p.ready()
    p.state.draft.onboarding_fee = '750'
    await p.state.submit()
    expect(p.patches()).toEqual([])
  })
})

describe('billing settings refund window and reload', () => {
  it('accepts Arabic-Indic digits in the refund days, like the fee field', async () => {
    const p = await page(); p.ready()
    p.state.draft.refund_window_days = '٣٠'
    expect(p.state.errors.value).toEqual({})
    await p.state.submit()
    expect(p.sent()).toMatchObject({ refund_window_days: 30 })
  })

  it.each(['٣٦٦', '-1', '1.5', '', 'abc'])('refuses %j as the refund days', async value => {
    const p = await page(); p.ready()
    p.state.draft.refund_window_days = value
    expect(p.state.errors.value.window).toBe('vendor.billingSettings.errors.window')
    await p.state.submit()
    expect(p.patches()).toEqual([])
  })

  it('says «saved» alone after a successful save and reload', async () => {
    const p = await page(); p.ready()
    p.state.draft.bank_account_name = 'Liwan'
    await p.state.submit()
    expect(p.state.saved.value).toBe(true); expect(p.state.failure.value).toBeNull(); expect(p.state.error.value).toBeNull()
  })

  it('never shows «saved» next to a failed reload: the page state reports it with its retry', async () => {
    const p = await page({ reloadFails: true }); p.ready()
    p.state.draft.bank_account_name = 'Liwan'
    await p.state.submit()
    expect(p.patches()).toHaveLength(1)
    expect(p.state.error.value).toBeTruthy()
    expect(p.state.saved.value).toBe(false)
    expect(p.state.failure.value).toBeNull()
    expect(p.state.busy.value).toBe(false)
  })

  it('shows the refusal alone when the save itself fails', async () => {
    const p = await page(); p.ready()
    p.request.mockRejectedValueOnce({ statusCode: 422, data: { code: 'invalid' } })
    p.state.draft.bank_account_name = 'Liwan'
    await p.state.submit()
    expect(p.state.failure.value).toBeTruthy(); expect(p.state.saved.value).toBe(false); expect(p.state.busy.value).toBe(false)
  })
})
