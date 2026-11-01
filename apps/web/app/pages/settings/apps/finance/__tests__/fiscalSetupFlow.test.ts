import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { QueryClient, VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../../composables/useApi'
import { useSettingsForm } from '../../../../../composables/settings/useSettingsForm'
import * as setupComposables from '../../../../../composables/finance/useFinanceSetup'
import * as fiscalRules from '../../../../../composables/finance/financeFiscalSetup'

// The real <script setup> of the fiscal card, driven without a DOM: the real composables run on a real query client, and
// only the network, the session and the browser are replaced. The card is kept alive across identity changes (the page
// mounts a new one), which is the worst case for a stale answer. Every request is a deferred promise the test settles in
// the order that exposes it.
const cardFile = resolve(import.meta.dirname, '../../../../../components/finance/FiscalSetupCard.vue')

type Fiscal = { fiscalyear_last_day: number; fiscalyear_last_month: number; fiscalyear_lock_date: string | null
  tax_lock_date: null; sale_lock_date: null; purchase_lock_date: null; hard_lock_date: null; transfer_account: { id: number; name: string } | null }
const fiscal = (day: number, lock: string | null = null): Fiscal => ({
  fiscalyear_last_day: day, fiscalyear_last_month: 12, fiscalyear_lock_date: lock,
  tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null, hard_lock_date: null, transfer_account: null,
})
type Call = { url: string; method: string; body: unknown; resolve: (value: unknown) => void; reject: (cause: unknown) => void }

const cleanups: Array<() => void> = []
afterEach(() => { onlineManager.setOnline(true); for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals() })

function mountCard() {
  const calls: Call[] = []
  const api = (url: string, options: { method?: string; body?: unknown } = {}) => new Promise((resolvePromise, rejectPromise) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body, resolve: resolvePromise, reject: rejectPromise })
  })
  const me = Vue.ref<{ id: number; company: { id: number }; access_policy_version: number } | null>(null)
  const focused: string[] = []
  const toasts: unknown[] = []
  const emitted: unknown[][] = []
  const identity = setupComposables.createFinanceIdentityGeneration(me)
  cleanups.push(identity.stop)
  const nuxtApp = { $financeIdentityGeneration: identity.generation }
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useNuxtApp', () => nuxtApp)
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: Vue.ref('en') }))
  vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => focused.push(id) }) })

  const descriptor = parse(readFileSync(cardFile, 'utf8'), { filename: cardFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'fiscal-card', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, nextTick: Vue.nextTick,
    useHydrated: () => Vue.ref(true),
    onBeforeRouteLeave: () => undefined,
    useToast: () => ({ add: (toast: unknown) => toasts.push(toast) }),
    useSettingsForm, ApiError,
    // The template is not rendered here; the script only names the picker it imports.
    AccountPicker: {}, useAccess: () => ({ can: () => true }),
    ...setupComposables, ...fiscalRules,
  }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = Vue.createApp({ render: () => null })
  app.use(VueQueryPlugin, { queryClient: client })
  const scope = Vue.effectScope()
  const setup = app.runWithContext(() => scope.run(() => setupComposables.useFinanceSetup()))!
  cleanups.push(() => { scope.stop(); client.clear() })

  /** A card made for the identity on screen now; it follows the setup query like the page binds it. */
  function makeCard() {
    const props = Vue.reactive({
      get setup() { return setup.data.value },
      scope: setup.scope.value,
      canEdit: true,
      contextChanged: false,
      reloadSetup: async () => { throw new Error('not used') },
    })
    const card = app.runWithContext(() => scope.run(() => component.setup(props, { expose: () => undefined, attrs: {}, slots: {}, emit: (...args: unknown[]) => emitted.push(args) }))) as Record<string, Vue.Ref | ((...args: never[]) => unknown)>
    return card
  }
  let card: ReturnType<typeof makeCard> | null = null
  const value = <T>(name: string) => Vue.unref(card![name]) as T
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); await Vue.nextTick() }
  const pending = (url: string, method: string) => calls.filter(call => call.url === url && call.method === method)
  return {
    me, calls, focused, toasts, emitted, client, value, settle, pending,
    card: () => card!,
    draft: () => card!.draft as Vue.Ref<Record<string, string | null>>,
    submit: () => (card!.submit as () => Promise<void>)(),
    open: async (user: number, company: number, day: number) => {
      me.value = asUser(user, company)
      await settle()
      pending(SETUP_URL, 'GET').at(-1)!.resolve({ fiscal: fiscal(day) })
      await settle()
      card = makeCard()
    },
  }
}

const SETUP_URL = '/api/v1/finance/setup'
const FISCAL_URL = '/api/v1/finance/setup/fiscal'
const asUser = (id: number, company: number) => ({ id, company: { id: company }, access_policy_version: 1 })
type Harness = ReturnType<typeof mountCard>
const baselineDay = (h: Harness) => h.value<{ fiscalyear_last_day: string }>('baseline').fiscalyear_last_day
const cachedDays = (h: Harness) => h.client.getQueryCache().findAll({ queryKey: setupComposables.financeSetupKey })
  .map(query => (query.state.data as { fiscal: Fiscal } | undefined)?.fiscal.fiscalyear_last_day)
  .filter(day => day !== undefined)

describe('a save answered after the screen left its identity', () => {
  it.each([
    ['A, then nobody, then A again', (h: Harness) => { h.me.value = null }, 1],
    ['A, then B, then A again', (h: Harness) => { h.me.value = asUser(8, 3) }, 2],
  ])('is dropped when the view came back to the same identity (%s)', async (_name, detour, reads) => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    const saving = h.submit()
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
    expect(baselineDay(h)).toBe('30')

    save.resolve({ fiscal: fiscal(15) })
    await saving
    await h.settle()
    expect(baselineDay(h)).toBe('30')
    expect(h.toasts).toEqual([])
    expect(cachedDays(h)).not.toContain(15)
  })
})

describe('several broken rules', () => {
  it('summarize every invalid control, keep the field messages and focus the first field', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '40'
    h.draft().value.fiscalyear_last_month = '13'
    await h.submit()
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(0)
    expect(h.value<Array<{ field: string; label: string; message: string }>>('summary')).toEqual([
      { field: 'fiscalyear_last_day', label: 'finance.setup.fiscal.yearEndDay', message: 'finance.setup.fiscal.errors.invalidDay' },
      { field: 'fiscalyear_last_month', label: 'finance.setup.fiscal.yearEndMonth', message: 'finance.setup.fiscal.errors.invalidMonth' },
    ])
    const message = h.card().fieldMessage as (field: string) => string | undefined
    expect(message('fiscalyear_last_day')).toBe('finance.setup.fiscal.errors.invalidDay')
    expect(message('fiscalyear_last_month')).toBe('finance.setup.fiscal.errors.invalidMonth')
    expect(h.focused).toEqual(['finance-fiscal-fiscalyear_last_day'])
  })

  it('stay out of the summary for a single error', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '40'
    await h.submit()
    expect(h.value<unknown[]>('summary')).toEqual([])
  })
})

describe('the transfer account of the card', () => {
  it('is sent alone when it is the only change', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    ;(h.draft().value as Record<string, unknown>).transfer_account_id = 102
    const saving = h.submit()
    await h.settle()
    const [call] = h.pending(FISCAL_URL, 'PATCH')
    expect(call?.body).toEqual({ transfer_account_id: 102 })
    call!.resolve({ fiscal: { ...fiscal(31), transfer_account: { id: 102, name: '100002 Suspense' } } })
    await saving
    await h.settle()
    expect(h.toasts).toHaveLength(1)
  })

  it('shows the message under its own field when the server refuses the account, and keeps the draft', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    ;(h.draft().value as Record<string, unknown>).transfer_account_id = 5
    const saving = h.submit()
    await h.settle()
    h.pending(FISCAL_URL, 'PATCH')[0]!.reject(new ApiError(422, 'invalid', 'transfer_account_id is not a reconcilable current asset', 'transfer_account_id'))
    await saving
    await h.settle()
    expect((h.draft().value as Record<string, unknown>).transfer_account_id).toBe(5)
    expect((h.card().fieldMessage as (field: string) => string | undefined)('transfer_account_id')).toBe('transfer_account_id is not a reconcilable current asset')
  })
})

describe('a refusal of the server', () => {
  it('keeps the draft, names the field and reports no success', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '30'
    const saving = h.submit()
    await h.settle()
    h.pending(FISCAL_URL, 'PATCH')[0]!.reject(new ApiError(422, 'fiscal_year_has_posted_entries', 'server text', 'fiscalyear_last_day'))
    await saving
    await h.settle()
    expect(h.draft().value.fiscalyear_last_day).toBe('30')
    expect(h.toasts).toEqual([])
    expect(h.value<{ message: string }>('state').message).toBe('finance.setup.fiscal.errors.fiscal_year_has_posted_entries')
    expect((h.card().fieldMessage as (field: string) => string | undefined)('fiscalyear_last_day')).toBe('finance.setup.fiscal.errors.fiscal_year_has_posted_entries')
  })
})

describe('a write refused because the company or sign-in changed', () => {
  it('drops the draft and tells the page to read again', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '30'
    const saving = h.submit()
    await h.settle()
    h.pending(FISCAL_URL, 'PATCH')[0]!.reject(new ApiError(409, 'request_context_changed', 'server text'))
    await saving
    await h.settle()
    expect(h.draft().value.fiscalyear_last_day).toBe('31')
    expect(h.emitted).toContainEqual(['contextChanged'])
    expect(h.toasts).toEqual([])
  })
})

describe('a write queued while offline', () => {
  const detours: Array<[string, (h: Harness) => void]> = [
    ['A, then nobody, then A again', h => { h.me.value = null }],
    ['A, then B, then A again', h => { h.me.value = asUser(8, 3) }],
  ]

  it.each(detours)('never reaches the network for a fiscal save once the view left and returned (%s)', async (_name, detour) => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    onlineManager.setOnline(false)
    const saving = h.submit()
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
    expect(h.toasts).toEqual([])
  })

  it('still sends when the identity never moved', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    onlineManager.setOnline(false)
    const saving = h.submit()
    await h.settle()
    onlineManager.setOnline(true)
    void h.client.resumePausedMutations()
    await h.settle()
    expect(h.pending(FISCAL_URL, 'PATCH')).toHaveLength(1)
    h.pending(FISCAL_URL, 'PATCH')[0]!.resolve({ fiscal: fiscal(15) })
    await saving
  })
})

describe('a background setup read that is older than a fiscal save', () => {
  it('cannot overwrite the saved settings when it started before the PATCH', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    h.draft().value.fiscalyear_last_day = '15'
    const saving = h.submit()
    await h.settle()
    // The focus refetch starts after the PATCH began and resolves after its success.
    void h.client.refetchQueries({ queryKey: setupComposables.financeSetupKey })
    await h.settle()
    const staleRead = h.pending(SETUP_URL, 'GET').at(-1)!
    h.pending(FISCAL_URL, 'PATCH')[0]!.resolve({ fiscal: fiscal(15) })
    await saving
    await h.settle()
    staleRead.resolve({ fiscal: fiscal(31) })
    await h.settle()
    expect(cachedDays(h)).toEqual([15])
    expect(baselineDay(h)).toBe('15')
    expect(h.draft().value.fiscalyear_last_day).toBe('15')
  })

  it('cannot overwrite the saved settings when it started before the save was made', async () => {
    const h = mountCard()
    await h.open(7, 3, 31)
    void h.client.refetchQueries({ queryKey: setupComposables.financeSetupKey })
    await h.settle()
    const staleRead = h.pending(SETUP_URL, 'GET').at(-1)!
    h.draft().value.fiscalyear_last_day = '15'
    const saving = h.submit()
    await h.settle()
    h.pending(FISCAL_URL, 'PATCH')[0]!.resolve({ fiscal: fiscal(15) })
    await saving
    await h.settle()
    staleRead.resolve({ fiscal: fiscal(31) })
    await h.settle()
    expect(cachedDays(h)).toEqual([15])
    expect(baselineDay(h)).toBe('15')
  })
})
