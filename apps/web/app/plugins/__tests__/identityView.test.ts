import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as Vue from 'vue'
import * as Query from '@tanstack/vue-query'
import { MeSchema } from '@liwan/contracts'
import * as tenantSuspension from '../../utils/tenantSuspension'
import { ApiError, useApi } from '../../composables/useApi'
import { renderToString } from '@vue/server-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import * as sessionExpiry from '../../utils/sessionExpiry'
import { companySwitching } from '../../utils/companySwitch'
import * as hydrationIds from '../../lib/hydrationIds'
import * as ssr from '../../lib/vueQuerySsr'
import * as sessionQueries from '../../lib/sessionQueryScope'
import SessionQueryProvider from '../../components/shell/SessionQueryProvider'
import { beginAccessRefreshInFlight, drainAccessRefreshInFlight } from '../../composables/useAdminUsers'

const active: Array<() => void> = []
afterEach(() => { companySwitching.value = false; active.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals(); tenantSuspension.clearTenantSuspension(); tenantSuspension.onTenantSuspension(() => {}) })
const text = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(text).join('')
const settle = async () => { for (let index = 0; index < 4; index++) { await Promise.resolve(); await Vue.nextTick() } }
type Identity = { id: number; company: { id: number }; capabilities: string[]; access_policy_version: number; name: string }
const identity = (company: number): Identity => ({ id: 7, company: { id: company }, capabilities: ['records.read'], access_policy_version: 1, name: 'User' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function plugin(filename: string, bindings: Record<string, unknown>, server = false) {
  const source = readFileSync(resolve(import.meta.dirname, '..', filename), 'utf8').replace(/^import[^\n]*\n/gm, '').replaceAll('import.meta.server', String(server)).replaceAll('import.meta.client', String(!server)).replace('export default', 'return')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const valid = Object.fromEntries(Object.entries(bindings).filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default'))
  return new Function(...Object.keys(valid), code)(...Object.values(valid)) as { setup: (nuxt: unknown) => unknown }
}
function fixture(options: { access?: string; server?: boolean; hydrating?: boolean; payload?: ssr.SerializedDehydratedState; read?: (company: number, signal: AbortSignal) => Promise<string>; mutate?: (company: number) => Promise<string>; expireOnRefresh?: boolean; identityRefreshError?: { statusCode: number }; initialIdentity?: Identity | null; initialStatus?: 'success' | 'idle'; identityRefresh?: () => Promise<Identity | null> } = {}) {
  const me = Vue.ref<Identity | null>(options.initialIdentity === undefined ? identity(1) : options.initialIdentity)
  const identityError = Vue.ref<unknown>()
  const identityStatus = Vue.ref<'idle' | 'pending' | 'success' | 'error'>(options.initialStatus ?? 'success')
  const route = Vue.reactive({ path: '/private-records', fullPath: '/private-records', meta: { access: options.access } })
  const locale = Vue.ref('en')
  const state = Vue.ref(options.payload ?? null)
  const hooks = new Map<string, () => unknown>()
  const reads: number[] = []
  const mutationClients: Query.QueryClient[] = []
  const mutate: Array<() => Promise<unknown>> = []
  const mutationCallbacks: string[] = []
  const busClients: Query.QueryClient[] = []
  const navigateTo = vi.fn()
  const focusListeners: Array<() => void> = []
  const toasts = Vue.ref<unknown[]>([])
  let suspensionClears = 0
  let recoveryRefreshes = 0
  const privateDrafts: Vue.Ref<string>[] = []
  let publicReads = 0
  const layoutKeys: Array<string | number | symbol | null | undefined> = []
  let layouts = 0
  let privateMounts = 0
  let publicMounts = 0
  let identityRequests = 0
  const identityRequest = { data: me, error: identityError, status: identityStatus, refresh: async () => {
    recoveryRefreshes++
    if (options.identityRefresh) {
      identityStatus.value = 'pending'
      try {
        me.value = await options.identityRefresh()
        identityError.value = undefined
        identityStatus.value = 'success'
      } catch (error) {
        identityError.value = error
        me.value = null
        identityStatus.value = 'error'
      }
    } else if (options.identityRefreshError) {
      identityStatus.value = 'pending'
      identityError.value = options.identityRefreshError
      me.value = null
      identityStatus.value = 'error'
    } else if (options.expireOnRefresh) me.value = null
  } }
  const identitySource = readFileSync(resolve(import.meta.dirname, '../../composables/useMe.ts'), 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.server', String(!!options.server))
  const identityCode = ts.transpileModule(identitySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const productionUseMe = new Function('computed', 'MeSchema', 'useRequestHeaders', 'useNuxtApp', 'useNuxtData', 'useFetch', `${identityCode}\nreturn useMe`)(Vue.computed, MeSchema, () => ({}), () => ({ isHydrating: options.hydrating }), () => ({ data: me }), () => identityRequest)
  const useMe = (settings?: { immediate?: boolean }) => { if (settings?.immediate !== false) identityRequests++; return productionUseMe(settings) }
  const Pass = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
  const Layout = Vue.defineComponent({ setup(_, { slots }) { layouts++; layoutKeys.push(Vue.getCurrentInstance()!.vnode.key); return () => Vue.h('section', slots.default?.()) } })
  const Private = Vue.defineComponent({ setup() {
    privateMounts++
    if (!me.value) return () => Vue.h('p', 'signed-out')
    const company = me.value.company.id
    const mutationClient = Query.useQueryClient()
    mutationClients.push(mutationClient)
    const mutation = Query.useMutation({
      mutationFn: () => options.mutate?.(company) ?? Promise.resolve(`mutation-${company}`),
      onSuccess: () => { mutationCallbacks.push(`success-${company}`); mutationClient.setQueryData(['private-records'], `old-success-${company}`) },
      onError: () => { mutationCallbacks.push(`error-${company}`); mutationClient.setQueryData(['private-records'], `old-error-${company}`) },
      onSettled: () => { mutationCallbacks.push(`settled-${company}`); mutationClient.setQueryData(['private-records'], `old-settled-${company}`) },
    })
    mutate.push(() => mutation.mutateAsync())
    const draft = Vue.ref(`draft-${company}`)
    privateDrafts.push(draft)
    const query = Query.useQuery({ queryKey: ['private-records'], staleTime: Infinity, queryFn: ({ signal }) => { reads.push(company); return options.read?.(company, signal) ?? Promise.resolve(`company-${company}`) } })
    return () => Vue.h('div', [Vue.h('p', query.data.value ?? 'loading'), Vue.h('input', { value: draft.value })])
  } })
  const Public = Vue.defineComponent({ setup() {
    publicMounts++
    const draft = Vue.ref('public-token-draft')
    const booking = Query.useQuery({ queryKey: ['public-booking'], staleTime: Infinity, queryFn: async () => `public-booking-${++publicReads}` })
    return () => Vue.h('div', [Vue.h('input', { value: draft.value }), Vue.h('p', booking.data.value ?? 'loading')])
  } })
  const Page = Vue.defineComponent({ setup: () => () => Vue.h(route.meta.access ? Public : Private) })
  const Root = loadShared(resolve(import.meta.dirname, '../../app.vue'), {
    modules: { '@nuxt/ui/locale': { ar: {}, en: {} }, '@/utils/appearance': { htmlAttrsFor: () => ({}) }, '@/utils/workspacePresentation': { pageArea: () => 'plain' }, '@/utils/sessionExpiry': sessionExpiry, '@/lib/sessionQueryScope': sessionQueries, '@/components/shell/SessionQueryProvider': { __esModule: true, default: SessionQueryProvider } },
    globals: { providePageArea: () => {}, useI18n: () => ({ locale }), useAppearance: () => ({ mode: Vue.ref('light'), fontSize: Vue.ref('small'), syncFromUser: () => {} }), useMe, useRoute: () => route, useLocaleHead: () => Vue.ref({ htmlAttrs: {} }), useHead: () => {} },
  })
  const app: Vue.App<HostNode | Element> = options.server ? Vue.createSSRApp(Root) : hostRenderer.createApp(Root)
  for (const [name, component] of Object.entries({ ...DEFAULT_STUBS, UApp: Pass, NuxtLayout: Layout, NuxtPage: Page })) app.component(name, component)
  const nuxt = { $i18n: { t: (key: string) => key }, isHydrating: !!options.hydrating, vueApp: app, runWithContext: (fn: () => unknown) => app.runWithContext(fn), hook: (name: string, fn: () => unknown) => hooks.set(name, fn), hooks: { hook: (name: string, fn: () => unknown) => hooks.set(name, fn) } }
  const bindings = { ...Vue, ...Query, ...hydrationIds, ...ssr, ...sessionExpiry, ...sessionQueries, companySwitching, defineNuxtPlugin: (value: unknown) => value, useState: () => state, useRouter: () => ({ currentRoute: Vue.ref(route) }), useMe, onTenantSuspension: tenantSuspension.onTenantSuspension, dropToastsWhileSuspended: tenantSuspension.dropToastsWhileSuspended, useToast: () => ({ toasts, add: (toast: unknown) => { toasts.value.push(toast) }, clear: () => { toasts.value = [] } }), clearTenantSuspension: () => { suspensionClears++; tenantSuspension.clearTenantSuspension() }, beginAccessRefreshInFlight, drainAccessRefreshInFlight, useEventListener: (_target: unknown, event: string, listener: () => void) => { if (event === 'focus') focusListeners.push(listener) }, window: {}, navigateTo, clearChatDrafts: () => {}, isTenantSuspended: tenantSuspension.isTenantSuspended, useBus: () => ({ connect: () => {}, disconnect: () => {} }), setBusQueryClient: (client: Query.QueryClient) => { busClients.push(client) } }
  const scope = Vue.effectScope()
  let access: { provide: { waitForAccessRefresh: () => Promise<void> } } | undefined
  scope.run(() => {
    plugin('vue-query.ts', bindings, options.server).setup(nuxt)
    if (!options.server) {
      access = app.runWithContext(() => plugin('access-refresh.client.ts', bindings).setup(nuxt)) as typeof access
      app.runWithContext(() => plugin('bus.client.ts', bindings).setup(nuxt))
    }
  })
  const queryScope = app.runWithContext(sessionQueries.useSessionQueryScope)
  const root = createHostNode()
  if (!options.server) app.mount(root)
  active.push(() => { if (!options.server) app.unmount(); scope.stop(); queryScope.current.value.client.clear() })
  return { me, route, locale, app, get client() { return queryScope.current.value.client }, queryScope, root, reads, identityError, identityStatus, refreshIdentity: identityRequest.refresh, toasts, suspensionClears: () => suspensionClears, focus: () => focusListeners.forEach(listener => listener()), mutate, mutationClients, busClients, mutationCallbacks, privateDrafts, layoutKeys, state, hooks, wait: () => access!.provide.waitForAccessRefresh(), counts: () => ({ layouts, privateMounts, publicMounts, identityRequests }), publicReads: () => publicReads, recoveryRefreshes: () => recoveryRefreshes, navigateTo }
}

it('replaces mounted private observers on a same-user company boundary with exactly one new read', async () => {
  const view = fixture()
  await settle()
  expect(text(view.root)).toContain('company-1')
  view.me.value = identity(2)
  await view.wait(); await settle()
  expect(text(view.root)).not.toContain('company-1')
  expect(text(view.root)).toContain('company-2')
  expect(view.reads).toEqual([1, 2])
  expect(view.counts().privateMounts).toBe(2)
})
it('keeps same-identity refresh, locale and policy refresh on the existing view', async () => {
  const view = fixture()
  await settle()
  view.privateDrafts[0]!.value = 'unsaved draft'
  view.me.value = { ...identity(1), name: 'Updated name' }
  view.locale.value = 'ar'
  await view.wait(); await settle()
  expect(view.reads).toEqual([1])
  expect(view.counts().layouts).toBe(1)
  view.me.value = { ...identity(1), access_policy_version: 2, capabilities: ['records.read', 'records.write'] }
  await view.wait(); await settle()
  expect(view.counts().layouts).toBe(1)
  expect(view.reads).toEqual([1, 1])
  expect(view.privateDrafts).toHaveLength(1)
  expect(view.privateDrafts[0]!.value).toBe('unsaved draft')
})
it('never publishes an old result after rapid company A to B to C changes', async () => {
  const held = deferred<string>()
  const view = fixture({ read: company => company === 2 ? held.promise : Promise.resolve(`company-${company}`) })
  await settle()
  view.me.value = identity(2)
  await settle()
  expect(view.reads).toEqual([1, 2])
  view.me.value = identity(3)
  await view.wait(); await settle()
  held.resolve('company-2')
  await settle()
  expect(view.reads).toEqual([1, 2, 3])
  expect(text(view.root)).toContain('company-3')
  expect(text(view.root)).not.toContain('company-2')
})
it.each(['public', 'guest'])('keeps a %s token view stable without private bootstrap or data reads', async access => {
  const view = fixture({ access })
  await settle()
  view.me.value = identity(2)
  await view.wait(); await settle()
  expect(view.counts()).toEqual({ layouts: 1, privateMounts: 0, publicMounts: 1, identityRequests: 0 })
  expect(view.reads).toEqual([])
})
it('keeps the same private view key and SSR result through initial hydration', async () => {
  const server = fixture({ server: true })
  await renderToString(server.app)
  await server.hooks.get('app:rendered')?.()
  const client = fixture({ hydrating: true, payload: server.state.value! })
  await settle()
  expect(client.layoutKeys).toEqual(server.layoutKeys)
  expect(text(client.root)).toContain('company-1')
  expect(client.reads).toEqual([])
})

it('clears a synchronously changed company before a replacement observer can reuse cached data', async () => {
  const view = fixture()
  await settle()
  view.me.value!.company.id = 2
  await view.wait(); await settle()
  expect(text(view.root)).toContain('company-2')
  expect(text(view.root)).not.toContain('company-1')
  expect(view.reads).toEqual([1, 2])
})
it('does not let an older policy reset cancel the new identity view', async () => {
  const view = fixture()
  await settle()
  const held = deferred<void>()
  const cancel = view.client.cancelQueries.bind(view.client)
  vi.spyOn(view.client, 'cancelQueries').mockImplementation(async (...args) => { await cancel(...args); await held.promise })
  view.me.value = { ...identity(1), access_policy_version: 2 }
  await settle()
  view.me.value = identity(2)
  await view.wait(); await settle()
  held.resolve()
  await settle()
  expect(view.reads).toEqual([1, 2])
  expect(text(view.root)).toContain('company-2')
})
it('does not key the layout by an ordinary private route change', async () => {
  const view = fixture()
  await settle()
  view.route.path = '/another-private-route'
  await settle()
  expect(view.counts().layouts).toBe(1)
  expect(view.reads).toEqual([1])
})

it('retains the active public observer across identity changes and removes stale private cache before entry', async () => {
  const view = fixture({ access: 'public' })
  await settle()
  view.client.setQueryData(['private-records'], 'company-1')
  const booking = view.client.getQueryCache().find({ queryKey: ['public-booking'] })
  expect(text(view.root)).toContain('public-booking-1')
  view.me.value = identity(2)
  await view.wait(); await settle()
  expect(view.client.getQueryCache().find({ queryKey: ['public-booking'] })).toBe(booking)
  expect(view.publicReads()).toBe(1)
  expect(view.counts()).toEqual({ layouts: 1, privateMounts: 0, publicMounts: 1, identityRequests: 0 })
  await view.client.invalidateQueries({ queryKey: ['public-booking'] })
  await settle()
  expect(text(view.root)).toContain('public-booking-2')
  view.route.meta.access = undefined
  await settle(); await view.wait(); await settle()
  expect(view.reads).toEqual([2])
  expect(text(view.root)).toContain('company-2')
  expect(text(view.root)).not.toContain('company-1')
})

it.each(['success', 'error'])('isolates retired mutation %s and settled callbacks from the active company cache', async outcome => {
  let resolve!: (value: string) => void
  let reject!: (reason: Error) => void
  const held = new Promise<string>((done, fail) => { resolve = done; reject = fail })
  const view = fixture({ mutate: () => held })
  await settle()
  const pending = view.mutate[0]!().catch(() => {})
  await settle()
  view.me.value = identity(2)
  await view.wait(); await settle()
  if (outcome === 'success') resolve('server-company-1')
  else reject(new Error('old failure'))
  await pending; await settle()
  expect(view.mutationCallbacks).toEqual([`${outcome}-1`, 'settled-1'])
  expect(text(view.root)).toContain('company-2')
  expect(text(view.root)).not.toContain('old-settled-1')
  expect(view.client.getQueryData(['private-records'])).toBe('company-2')
  expect(view.mutationClients[0]).not.toBe(view.mutationClients[1])
})
it('never reuses a previous private client on A to B to A and rejects its late mutation', async () => {
  const held = deferred<string>()
  const view = fixture({ mutate: () => held.promise })
  await settle()
  const pending = view.mutate[0]!()
  await settle()
  view.me.value = identity(2)
  await view.wait(); await settle()
  view.me.value = identity(1)
  await view.wait(); await settle()
  held.resolve('old A')
  await pending; await settle()
  expect(new Set(view.mutationClients).size).toBe(3)
  expect(text(view.root)).toContain('company-1')
  expect(text(view.root)).not.toContain('old-settled-1')
  expect(view.reads).toEqual([1, 2, 1])
})
it('does not let an old mutation session refusal recover or log out the new owner', async () => {
  let reject!: (reason: Error) => void
  const held = new Promise<string>((_done, fail) => { reject = fail })
  const view = fixture({ mutate: () => held, expireOnRefresh: true })
  await settle()
  const pending = view.mutate[0]!().catch(() => {})
  await settle()
  view.me.value = identity(2)
  await view.wait(); await settle()
  reject(new (await import('../../composables/useApi')).ApiError(401, 'session_required', 'old session'))
  await pending; await settle()
  expect(view.recoveryRefreshes()).toBe(0)
  expect(view.navigateTo).not.toHaveBeenCalled()
  expect(view.me.value?.company.id).toBe(2)
  expect(text(view.root)).toContain('company-2')
})

it('still redirects a legitimate current-owner 401 when refresh ends that session', async () => {
  const view = fixture({ mutate: async () => { throw new (await import('../../composables/useApi')).ApiError(401, 'session_required', 'expired') }, expireOnRefresh: true })
  await settle()
  const before = view.client
  await view.mutate[0]!().catch(() => {})
  await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.me.value).toBeNull()
  expect(view.client).not.toBe(before)
  expect(view.navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/private-records' } })
})
it('moves the bus invalidation target to each current owner without reusing retired clients', async () => {
  const view = fixture()
  await settle()
  const first = view.client
  expect(view.busClients).toEqual([first])
  view.me.value = identity(2)
  await view.wait(); await settle()
  expect(view.busClients.at(-1)).toBe(view.client)
  expect(view.client).not.toBe(first)
  view.me.value = identity(1)
  await view.wait(); await settle()
  expect(new Set(view.busClients).size).toBe(3)
  expect(view.busClients.at(-1)).toBe(view.client)
})

it('unmounts a retired client with its provider and mounts the fresh owner client', async () => {
  vi.spyOn(Query.environmentManager, 'isServer').mockReturnValue(false)
  const mounted = vi.spyOn(Query.QueryClient.prototype, 'mount')
  const unmounted = vi.spyOn(Query.QueryClient.prototype, 'unmount')
  const view = fixture()
  await settle()
  expect(mounted).toHaveBeenCalledTimes(1)
  view.me.value = identity(2)
  await view.wait(); await settle()
  expect(mounted).toHaveBeenCalledTimes(2)
  expect(unmounted).toHaveBeenCalledTimes(1)
})


it.each([
  { kind: 'owner cancellation', error: new DOMException('retired owner', 'AbortError'), attempts: 1 },
  { kind: 'deterministic error', error: new Error('ordinary failure'), attempts: 1 },
  { kind: 'permission refusal', error: new ApiError(403, 'forbidden', 'Permission denied'), attempts: 1 },
  { kind: 'transient API failure', error: new ApiError(503, 'unavailable', 'Temporarily unavailable'), attempts: 2 },
])('applies the classified retry budget to $kind', async ({ error, attempts }) => {
  const view = fixture()
  let calls = 0
  const observer = new Query.QueryObserver(view.client, {
    queryKey: ['owner-cancellation-retry'],
    retryDelay: 0,
    queryFn: async () => { calls++; throw error },
  })
  const stop = observer.subscribe(() => {})
  try {
    await observer.getCurrentQuery().promise?.catch(() => {})
    expect(calls).toBe(attempts)
    expect(observer.getCurrentResult().error).toBe(error)
  } finally { stop() }
})


it.each([
  { statusCode: 500 },
  { statusCode: 0 },
  { statusCode: 500, cause: { name: 'ZodError' } },
])('retains the committed private view and draft after an unverified identity failure ($statusCode)', async failure => {
  const view = fixture()
  await settle()
  const client = view.client
  const observer = client.getQueryCache().find({ queryKey: ['private-records'] })!.observers[0]
  view.privateDrafts[0]!.value = 'unsaved local draft'
  // Installed Nuxt updates pending first, then error/data before final error status.
  view.identityStatus.value = 'pending'
  view.identityError.value = failure
  view.me.value = null
  view.identityStatus.value = 'error'
  await view.wait(); await settle()
  expect(view.counts().layouts).toBe(1)
  expect(view.client).toBe(client)
  expect(view.privateDrafts).toHaveLength(1)
  expect(view.privateDrafts[0]!.value).toBe('unsaved local draft')
  expect(client.getQueryCache().find({ queryKey: ['private-records'] })!.observers[0]).toBe(observer)
  // Recovery data/error also precede success; they must not imply a logout in between.
  view.identityStatus.value = 'pending'
  view.me.value = identity(1)
  view.identityError.value = undefined
  view.identityStatus.value = 'success'
  await view.wait(); await settle()
  expect(view.counts().layouts).toBe(1)
  expect(view.client).toBe(client)
  expect(view.reads).toEqual([1])
  expect(view.privateDrafts[0]!.value).toBe('unsaved local draft')
})


it.each([401, 403, null])('retires the private owner only after a confirmed session end (%s)', async statusCode => {
  const view = fixture()
  await settle()
  const client = view.client
  view.identityStatus.value = 'pending'
  view.identityError.value = statusCode === null ? undefined : { statusCode }
  view.me.value = null
  expect(view.client).toBe(client)
  view.identityStatus.value = statusCode === null ? 'success' : 'error'
  await view.wait(); await settle()
  expect(view.client).not.toBe(client)
  expect(view.queryScope.current.value.identity).toBe('anonymous')
  expect(view.counts().layouts).toBe(2)
})

it('does not turn a current request 401 into logout when its identity recheck is unverified', async () => {
  const view = fixture({ identityRefreshError: { statusCode: 500 }, mutate: async () => { throw new (await import('../../composables/useApi')).ApiError(401, 'session_required', 'recheck session') } })
  await settle()
  const client = view.client
  view.privateDrafts[0]!.value = 'pending draft'
  await view.mutate[0]!().catch(() => {})
  await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.navigateTo).not.toHaveBeenCalled()
  expect(view.client).toBe(client)
  expect(view.counts().layouts).toBe(1)
  expect(view.privateDrafts[0]!.value).toBe('pending draft')
})


it.each(['success', 'idle'] as const)('clears a latched suspension once after anonymous %s to pending to signed-in', async initialStatus => {
  vi.stubGlobal('window', {})
  tenantSuspension.reportTenantSuspension()
  const held = deferred<Identity | null>()
  const view = fixture({ access: 'guest', initialIdentity: null, initialStatus, identityRefresh: () => held.promise })
  await settle()
  expect(tenantSuspension.isTenantSuspended()).toBe(true)
  view.toasts.value = ['old failure']
  await settle()
  expect(view.toasts.value).toEqual([])
  const login = view.refreshIdentity()
  await settle()
  expect(view.identityStatus.value).toBe('pending')
  expect(tenantSuspension.isTenantSuspended()).toBe(true)
  held.resolve(identity(1))
  await login; await settle()
  expect(view.suspensionClears()).toBe(1)
  expect(tenantSuspension.isTenantSuspended()).toBe(false)
  view.toasts.value = ['new notification']
  await settle()
  expect(view.toasts.value).toEqual(['new notification'])
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: () => false, locale: { value: 'en' } }))
  vi.stubGlobal('useNuxtData', () => ({ data: { value: null } }))
  vi.stubGlobal('$fetch', async () => { throw { statusCode: 403, data: { code: 'forbidden', message: 'Permission denied' } } })
  await expect(view.app.runWithContext(useApi).$api('/api/v1/projects')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  // A later unverified failure and same-actor recovery must not clear a real latch.
  tenantSuspension.onTenantSuspension(() => {})
  tenantSuspension.reportTenantSuspension()
  view.identityStatus.value = 'pending'
  view.identityError.value = { statusCode: 500 }
  view.me.value = null
  view.identityStatus.value = 'error'
  await settle()
  view.identityStatus.value = 'pending'
  view.me.value = identity(1)
  view.identityError.value = undefined
  view.identityStatus.value = 'success'
  await settle()
  expect(view.suspensionClears()).toBe(1)
  expect(tenantSuspension.isTenantSuspended()).toBe(true)
})

it('revalidates on focus after an identity500 without replacing the committed private draft or client', async () => {
  let restored = false
  const view = fixture({ identityRefresh: async () => {
    if (!restored) throw { statusCode: 500 }
    return identity(1)
  } })
  await settle()
  const client = view.client
  const observer = client.getQueryCache().find({ queryKey: ['private-records'] })!.observers[0]
  view.privateDrafts[0]!.value = 'focus recovery draft'
  view.focus()
  await view.wait(); await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.me.value).toBeNull()
  expect(view.client).toBe(client)
  restored = true
  view.focus()
  await view.wait(); await settle()
  expect(view.recoveryRefreshes()).toBe(2)
  expect(view.me.value?.company.id).toBe(1)
  expect(view.counts().layouts).toBe(1)
  expect(view.client).toBe(client)
  expect(client.getQueryCache().find({ queryKey: ['private-records'] })!.observers[0]).toBe(observer)
  expect(view.privateDrafts[0]!.value).toBe('focus recovery draft')
  expect(view.reads).toEqual([1])
})

it.each(['initial-anonymous', 'guest', 'signed-in-guest', 'logout'])('does not bootstrap private identity on focus for %s', async state => {
  const view = fixture({
    access: state.includes('guest') ? 'guest' : undefined,
    initialIdentity: state === 'logout' || state === 'signed-in-guest' ? identity(1) : null,
    identityRefresh: async () => identity(1),
  })
  await settle()
  if (state === 'logout') {
    view.identityStatus.value = 'pending'
    view.me.value = null
    view.identityStatus.value = 'success'
    await view.wait(); await settle()
  }
  view.focus()
  await settle()
  expect(view.recoveryRefreshes()).toBe(0)
})

const staleCompany = () => new ApiError(409, 'request_context_changed', 'x')
const failing = (view: ReturnType<typeof fixture>, key: string) => view.client.fetchQuery({ queryKey: [key], queryFn: () => Promise.reject(staleCompany()), retry: false }).catch(() => {})

it('reloads me and says once that the working company changed when requests fail together with request_context_changed', async () => {
  const view = fixture()
  await settle()
  await Promise.all([failing(view, 'a'), failing(view, 'b')])
  await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.toasts.value).toEqual([{ title: 'errors.codes.request_context_changed', color: 'warning' }])
  await failing(view, 'c')
  await settle()
  expect(view.recoveryRefreshes()).toBe(2)
  expect(view.toasts.value).toHaveLength(2)
})

it('reloads me but shows no global message for a refused write: its own error surface says it', async () => {
  const view = fixture()
  await settle()
  await new Query.MutationObserver(view.client, { mutationFn: () => Promise.reject(staleCompany()) }).mutate().catch(() => {})
  await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.toasts.value).toEqual([])
})

it('stays silent for requests that fail while this tab switches company, and reports one that fails after it', async () => {
  const view = fixture()
  await settle()
  companySwitching.value = true
  await failing(view, 'during')
  await new Query.MutationObserver(view.client, { mutationFn: () => Promise.reject(staleCompany()) }).mutate().catch(() => {})
  await settle()
  expect(view.recoveryRefreshes()).toBe(0)
  expect(view.toasts.value).toEqual([])
  companySwitching.value = false
  await failing(view, 'after')
  await settle()
  expect(view.recoveryRefreshes()).toBe(1)
  expect(view.toasts.value).toHaveLength(1)
})

it('ignores other refusals and other 409 codes', async () => {
  const view = fixture()
  await settle()
  await view.client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(new ApiError(409, 'conflict', 'x')), retry: false }).catch(() => {})
  await settle()
  expect(view.recoveryRefreshes()).toBe(0)
  expect(view.toasts.value).toEqual([])
})
