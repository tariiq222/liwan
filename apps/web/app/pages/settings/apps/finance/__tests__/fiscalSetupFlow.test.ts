import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { QueryClient, VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../../composables/useApi'
import { financeSetupProgress } from '../../../../../composables/finance/financeSetupSteps'
import * as setupComposables from '../../../../../composables/finance/useFinanceSetup'
import * as fiscalRules from '../../../../../composables/finance/financeFiscalSetup'
import { saveErrorMessage } from '../../../../../utils/formFeedback'

// The real <script setup> of the finance settings page, driven without a DOM: the real composables run on a
// real query client, and only the network, the session and the browser are replaced. Every request is a
// deferred promise the test settles in the order that exposes a stale answer.
const pageFile = resolve(import.meta.dirname, '../index.vue')

type Fiscal = { fiscalyear_last_day: number; fiscalyear_last_month: number; fiscalyear_lock_date: string | null
  tax_lock_date: null; sale_lock_date: null; purchase_lock_date: null; hard_lock_date: null }
const fiscal = (day: number, lock: string | null = null): Fiscal => ({
  fiscalyear_last_day: day, fiscalyear_last_month: 12, fiscalyear_lock_date: lock,
  tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null, hard_lock_date: null,
})
type Call = { url: string; method: string; body: unknown; resolve: (value: unknown) => void; reject: (cause: unknown) => void }

const cleanups: Array<() => void> = []
afterEach(() => { onlineManager.setOnline(true); for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals() })

function mountPage() {
  const calls: Call[] = []
  const api = (url: string, options: { method?: string; body?: unknown } = {}) => new Promise((resolvePromise, rejectPromise) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body, resolve: resolvePromise, reject: rejectPromise })
  })
  const me = Vue.ref<{ id: number; company: { id: number }; access_policy_version: number } | null>(null)
  const focused: string[] = []
  const identity = setupComposables.createFinanceIdentityGeneration(me)
  cleanups.push(identity.stop)
  const nuxtApp = { $financeIdentityGeneration: identity.generation }
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useNuxtApp', () => nuxtApp)
  vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => focused.push(id) }) })

  const descriptor = parse(readFileSync(pageFile, 'utf8'), { filename: pageFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'finance-settings', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    useI18n: () => ({ t: (key: string) => (key === 'finance.setup.fiscal.errorSummary' ? 'Fix these fields before saving:' : key), locale: Vue.ref('en') }),
    useAccess: () => ({ can: () => true }),
    useSettingsPage: () => ({ parts: [], shows: () => true }),
    useHydrated: () => Vue.ref(true),
    onBeforeRouteLeave: () => undefined,
    // The server-side seed; this flow runs as the client, where the immediate watcher seeds the draft.
    useSsrQuerySeed: () => undefined,
    SettingsPreviewCard: {}, SetupChecklist: {}, AnalyticAccountsSection: {}, AnalyticPlansSection: {},
    AuditPreview: {}, ClosingView: {}, ZatcaView: {},
    financeSetupProgress, saveErrorMessage,
    ...setupComposables, ...fiscalRules,
  }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = Vue.createApp({ render: () => null })
  app.use(VueQueryPlugin, { queryClient: client })
  const scope = Vue.effectScope()
  const page = app.runWithContext(() => scope.run(() => component.setup({}, { expose: () => undefined, attrs: {}, slots: {}, emit: () => undefined }))) as Record<string, Vue.Ref | ((...args: never[]) => unknown)>
  cleanups.push(() => { scope.stop(); client.clear() })
  const value = <T>(name: string) => Vue.unref(page[name]) as T
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); await Vue.nextTick() }
  const pending = (url: string, method: string) => calls.filter(call => call.url === url && call.method === method)
  return { page, me, calls, focused, client, value, settle, pending, draft: () => page.fiscalDraft as Vue.Ref<Record<string, string | null>> }
}

const SETUP_URL = '/api/v1/finance/setup'
const FISCAL_URL = '/api/v1/finance/setup/fiscal'
const asUser = (id: number, company: number) => ({ id, company: { id: company }, access_policy_version: 1 })

async function openCompany(h: ReturnType<typeof mountPage>, user: number, company: number, day: number) {
  h.me.value = asUser(user, company)
  await h.settle()
  const read = h.pending(SETUP_URL, 'GET').at(-1)!
  read.resolve({ fiscal: fiscal(day) })
  await h.settle()
}

describe('a save answered after the screen left its identity', () => {
  it.each([
    ['A, then nobody, then A again', (h: ReturnType<typeof mountPage>) => { h.me.value = null }, 1],
    ['A, then B, then A again', (h: ReturnType<typeof mountPage>) => { h.me.value = asUser(8, 3) }, 2],
  ])('is dropped when the view came back to the same identity (%s)', async (_name, detour, reads) => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    const submit = h.page.submitFiscal as () => Promise<void>
    const saving = submit()
    await h.settle()
    const save = h.pending(FISCAL_URL, 'PATCH')[0]!

    detour(h)
    await h.settle()
    h.me.value = asUser(7, 3)
    await h.settle()
    // The returning view reads its own baseline again (and B's read, if it was shown, is not awaited).
    const rereads = h.pending(SETUP_URL, 'GET')
    expect(rereads.length).toBe(1 + reads)
    rereads.at(-1)!.resolve({ fiscal: fiscal(30) })
    await h.settle()
    expect(h.value<{ fiscalyear_last_day: string }>('fiscalBaseline').fiscalyear_last_day).toBe('30')

    save.resolve({ fiscal: fiscal(15) })
    await saving
    await h.settle()
    expect(h.value<{ fiscalyear_last_day: string }>('fiscalBaseline').fiscalyear_last_day).toBe('30')
    expect(h.value<boolean>('fiscalSaved')).toBe(false)
    const cached = h.client.getQueryCache().findAll({ queryKey: setupComposables.financeSetupKey })
      .map(query => (query.state.data as { fiscal: Fiscal } | undefined)?.fiscal.fiscalyear_last_day)
    expect(cached).not.toContain(15)
  })

  it('leaves the displayed identity alone when the old identity is refused', async () => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    const saving = (h.page.submitFiscal as () => Promise<void>)()
    await h.settle()
    const save = h.pending(FISCAL_URL, 'PATCH')[0]!

    h.me.value = asUser(7, 4)
    await h.settle()
    h.pending(SETUP_URL, 'GET').at(-1)!.resolve({ fiscal: fiscal(29) })
    await h.settle()
    expect(h.value<{ fiscalyear_last_day: string }>('fiscalBaseline').fiscalyear_last_day).toBe('29')

    save.reject(new ApiError(409, 'request_context_changed', 'changed'))
    await saving
    await h.settle()
    expect(h.value<{ fiscalyear_last_day: string }>('fiscalBaseline').fiscalyear_last_day).toBe('29')
    expect(h.draft().value.fiscalyear_last_day).toBe('29')
    expect(h.value('fiscalError')).toBeNull()
    expect(h.value('fiscalNoticeKey')).toBeNull()
  })

  it('does not report or keep the chart confirmation of an identity the screen left', async () => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    ;(h.page.confirmChart as Vue.Ref<boolean>).value = true
    const loading = (h.page.confirmLoadChart as () => Promise<void>)()
    await h.settle()
    const load = h.pending('/api/v1/finance/setup/chart', 'POST')[0]!

    h.me.value = asUser(7, 4)
    await h.settle()
    load.reject(new ApiError(409, 'request_context_changed', 'changed'))
    await loading
    await h.settle()
    expect(h.value('chartError')).toBeNull()
  })
})

describe('several broken rules', () => {
  it('summarize every invalid control, keep the field messages and focus the first field', async () => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '40'
    h.draft().value.fiscalyear_last_month = '13'
    await (h.page.submitFiscal as () => Promise<void>)()
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(0)
    expect(h.value<Array<{ field: string; label: string; message: string }>>('fiscalSummary')).toEqual([
      { field: 'fiscalyear_last_day', label: 'finance.setup.fiscal.yearEndDay', message: 'finance.setup.fiscal.errors.invalidDay' },
      { field: 'fiscalyear_last_month', label: 'finance.setup.fiscal.yearEndMonth', message: 'finance.setup.fiscal.errors.invalidMonth' },
    ])
    const message = h.page.fiscalFieldMessage as (field: string) => string | undefined
    expect(message('fiscalyear_last_day')).toBe('finance.setup.fiscal.errors.invalidDay')
    expect(message('fiscalyear_last_month')).toBe('finance.setup.fiscal.errors.invalidMonth')
    expect(h.focused).toEqual(['finance-fiscal-fiscalyear_last_day'])
  })

  it('stay out of the summary for a single error', async () => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '40'
    await (h.page.submitFiscal as () => Promise<void>)()
    expect(h.value<unknown[]>('fiscalSummary')).toEqual([])
  })
})

describe('a write queued while offline', () => {
  const CHART_URL = '/api/v1/finance/setup/chart'
  const detours: Array<[string, (h: ReturnType<typeof mountPage>) => void]> = [
    ['A, then nobody, then A again', h => { h.me.value = null }],
    ['A, then B, then A again', h => { h.me.value = asUser(8, 3) }],
  ]

  it.each(detours)('never reaches the network for a fiscal save once the view left and returned (%s)', async (_name, detour) => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    onlineManager.setOnline(false)
    const saving = (h.page.submitFiscal as () => Promise<void>)()
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(0)

    detour(h)
    h.me.value = asUser(7, 3)
    await h.settle()
    onlineManager.setOnline(true)
    await h.client.resumePausedMutations()
    await saving
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(0)
    expect(h.value('fiscalError')).toBeNull()
    expect(h.value<boolean>('fiscalSaved')).toBe(false)
  })

  it.each(detours)('never reaches the network for a chart load once the view left and returned (%s)', async (_name, detour) => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    onlineManager.setOnline(false)
    const loading = (h.page.confirmLoadChart as () => Promise<void>)()
    await h.settle()
    expect(h.pending(CHART_URL, 'POST')).toHaveLength(0)

    detour(h)
    h.me.value = asUser(7, 3)
    await h.settle()
    onlineManager.setOnline(true)
    await h.client.resumePausedMutations()
    await loading
    await h.settle()
    expect(h.pending(CHART_URL, 'POST')).toHaveLength(0)
    expect(h.value('chartError')).toBeNull()
  })

  it('still sends when the identity never moved', async () => {
    const h = mountPage()
    await openCompany(h, 7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    onlineManager.setOnline(false)
    const saving = (h.page.submitFiscal as () => Promise<void>)()
    await h.settle()
    onlineManager.setOnline(true)
    void h.client.resumePausedMutations()
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(1)
    h.pending(FISCAL_URL, 'PATCH')[0]!.resolve({ fiscal: fiscal(15) })
    await saving
  })
})
