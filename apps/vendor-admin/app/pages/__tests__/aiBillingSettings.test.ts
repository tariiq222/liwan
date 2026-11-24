import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vendorCommercial from '../../utils/vendorCommercial'
import * as vendorAiBilling from '../../utils/vendorAiBilling'

// The mounting harness of billingSettingsOnboardingFee.test.ts, reduced to the page's script: the template only forwards the draft.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))

const stored = { topup_amounts_minor: [2500, 5000], topup_minimum_minor: 2500, usd_rate: '3.75', trial_allowance_minor: 500, monthly_allowance_minor: 1000 }

async function page(options: { pushed?: number, grants?: string[], reloadFails?: boolean } = {}) {
  const filename = resolve(import.meta.dirname, '../ai-billing-settings.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'ai-billing-settings' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const request = vi.fn(async (_path: string, init?: { method?: string, body?: Record<string, unknown> }) => (init?.method === 'PATCH' ? { ...stored, ...init.body, pushed_tenants: options.pushed ?? 0 } : stored))
  const bindings = {
    ...vendorCommercial, ...vendorAiBilling, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, nextTick: Vue.nextTick, watch: Vue.watch, reactive: Vue.reactive,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true), useI18n: () => ({ t: (key: string) => key }),
    useVendorContext: () => ({ can: (grant: string) => (options.grants ?? ['vendor.read', 'vendor.billing.manage']).includes(grant) }),
    useVendorApi: () => ({ request }),
    useAsyncData: async (_key: string, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { try { data.value = await fn(); error.value = null } catch (cause) { error.value = cause } })
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const patches = () => request.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PATCH')
  const failReload = () => request.mockImplementation(async (_path, init) => { if (init?.method === 'PATCH') return { ...stored, ...init.body, pushed_tenants: 0 }; throw { statusCode: 503 } })
  return { state, request, patches, failReload }
}

describe('AI billing settings page', () => {
  it('loads the settings as riyal text and keeps the save closed until a reason is given', async () => {
    const p = await page()
    expect(p.request).toHaveBeenCalledWith('commercial/ai-billing-settings')
    expect(p.state.draft).toMatchObject({ topup_amounts: ['25.00', '50.00'], topup_minimum: '25.00', usd_rate: '3.75', trial_allowance: '5.00', monthly_allowance: '10.00', reason: '' })
    await p.state.submit()
    expect(p.patches()).toEqual([])
    expect(p.state.reasonError.value).toBe('vendor.aiBillingSettings.errors.reason')
  })

  it('sends the whole setting in minor units with the trimmed reason, and reports the workspaces updated', async () => {
    const p = await page({ pushed: 3 })
    p.state.draft.topup_amounts = ['25', '50', '100']; p.state.draft.monthly_allowance = '12.50'; p.state.draft.reason = '  New allowance for the quarter  '
    await p.state.submit()
    expect(p.patches()).toEqual([['commercial/ai-billing-settings', { method: 'PATCH', body: { topup_amounts_minor: [2500, 5000, 10000], topup_minimum_minor: 2500, usd_rate: '3.75', trial_allowance_minor: 500, monthly_allowance_minor: 1250, reason: 'New allowance for the quarter' } }]])
    expect(p.state.saved.value).toBe(true); expect(p.state.pushed.value).toBe(3)
  })

  it('keeps the zero-propagation sentence: a save that reached no workspace still states it', async () => {
    const p = await page({ pushed: 0 })
    p.state.draft.monthly_allowance = '12.50'; p.state.draft.reason = 'Quarter allowance'
    await p.state.submit()
    expect(p.state.saved.value).toBe(true); expect(p.state.pushed.value).toBe(0)
    const source = readFileSync(resolve(import.meta.dirname, '../ai-billing-settings.vue'), 'utf8')
    expect(source).toContain(':description="t(\'vendor.aiBillingSettings.pushed\', { count: pushed }, pushed)"')
  })

  it('refuses a wrong field with its own message and sends nothing', async () => {
    const p = await page()
    p.state.draft.reason = 'Review'; p.state.draft.usd_rate = '3,75'
    await p.state.submit()
    expect(p.patches()).toEqual([])
    expect(p.state.errorOf('usd_rate')).toBe('vendor.aiBillingSettings.errors.rate')
    expect(p.state.errorOf('topup_amounts_minor')).toBeUndefined()
    expect(p.state.summaryErrors.value).toEqual([{ field: 'rate', message: 'vendor.aiBillingSettings.errors.rate' }])
  })

  it('names the wrong amount row and lists every wrong field in the summary, in form order', async () => {
    const p = await page()
    p.state.draft.topup_amounts = ['25', '', 'x']; p.state.draft.topup_minimum = ''; p.state.draft.reason = ''
    expect(p.state.summaryErrors.value).toEqual([])
    await p.state.submit()
    expect(p.patches()).toEqual([])
    expect(p.state.amountRowErrors.value).toEqual([undefined, 'vendor.aiBillingSettings.errors.amountRow', 'vendor.aiBillingSettings.errors.amountRow'])
    expect(p.state.amountsListError.value).toBeUndefined()
    expect(p.state.summaryErrors.value.map((item: { field: string }) => item.field)).toEqual(['amounts', 'minimum', 'reason'])
  })

  it('moves focus to the summary after a refused save and not after an accepted one', async () => {
    const p = await page()
    const focus = vi.fn(); p.state.summary.value = { focus }
    p.state.draft.monthly_allowance = '12.50'
    await p.state.submit()
    expect(focus).toHaveBeenCalledTimes(1)
    p.state.draft.reason = 'Review'
    await p.state.submit()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(p.state.attempted.value).toBe(false)
  })

  it('shows a refused save and does not claim it was saved', async () => {
    const p = await page()
    p.request.mockImplementation(async (_path, init) => { if (init?.method === 'PATCH') throw { statusCode: 403, data: { code: 'step_up_required' } }; return stored })
    p.state.draft.reason = 'Review'; p.state.draft.monthly_allowance = '12.50'
    await p.state.submit()
    expect(p.state.saved.value).toBe(false)
    expect(p.state.failure.value).toMatchObject({ statusCode: 403 })
  })

  it('does not mark saved data as unsaved when the reload after the save fails', async () => {
    const p = await page()
    p.failReload()
    p.state.draft.monthly_allowance = '12.50'; p.state.draft.reason = 'Quarter allowance'
    expect(p.state.dirty.value).toBe(true)
    await p.state.submit()
    expect(p.patches()).toHaveLength(1)
    expect(p.state.dirty.value).toBe(false)
  })

  it('does not count the audit reason as an edit, and ends the «saved» message with the first edit', async () => {
    const p = await page()
    p.state.draft.reason = 'Typed first'
    expect(p.state.dirty.value).toBe(false)
    await p.state.submit()
    expect(p.patches()).toEqual([])
    p.state.draft.monthly_allowance = '12.50'; p.state.draft.reason = 'Quarter allowance'
    await p.state.submit()
    expect(p.state.saved.value).toBe(true)
    p.state.draft.monthly_allowance = '13.00'
    await Vue.nextTick()
    expect(p.state.saved.value).toBe(false)
  })

  it('does nothing for an account that may not manage billing', async () => {
    const p = await page({ grants: ['vendor.read'] })
    p.state.draft.reason = 'Review'
    await p.state.submit()
    expect(p.patches()).toEqual([])
  })
})
