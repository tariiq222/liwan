import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createFetch } from 'ofetch'
import * as Query from '@tanstack/vue-query'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApi, ApiError } from '../../composables/useApi'
import * as ssr from '../vueQuerySsr'
import * as sessionExpiry from '../../utils/sessionExpiry'
import * as sessionQueries from '../sessionQueryScope'

function plugin(hydrating = false, publicRoute = false) {
  const hooks = new Map<string, (...args: any[]) => any>()
  let identityRefreshes = 0
  let client!: Query.QueryClient
  const nuxt = {
    isHydrating: hydrating, hook: (name: string, fn: (...args: any[]) => any) => hooks.set(name, fn),
    hooks: { hook: () => {} }, runWithContext: (fn: () => any) => fn(),
    vueApp: { provide: (_key: unknown, scope: sessionQueries.SessionQueryScope) => { client = scope.current.value.client }, onUnmount: () => {}, mixin: () => {} },
  }
  const bindings = {
    ...Query, ...ssr, ...Vue, ...sessionExpiry, ...sessionQueries, defineNuxtPlugin: (value: any) => value,
    useState: () => Vue.ref(null), useRouter: () => ({ currentRoute: Vue.ref({ meta: { access: publicRoute ? 'public' : undefined }, fullPath: '/pay/invoice/1' }) }),
    isPossibleSessionExpiry: (error: unknown) => error instanceof ApiError && error.status === 401,
    useMe: () => ({ me: Vue.ref(null), ownershipIdentity: Vue.ref(null), refresh: async () => { identityRefreshes++ } }), onTenantSuspension: () => {},
    clearChatDrafts: () => {}, dropToastsWhileSuspended: () => {}, useToast: () => ({ toasts: Vue.ref([]) }),
  }
  const source = readFileSync(new URL('../../plugins/vue-query.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '').replaceAll('import.meta.server', String(!hydrating)).replaceAll('import.meta.client', String(hydrating)).replace('export default', 'return')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const valid = Object.fromEntries(Object.entries(bindings).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key)))
  new Function(...Object.keys(valid), code)(...Object.values(valid)).setup(nuxt)
  return { client, hooks, identityRefreshes: () => identityRefreshes }
}

afterEach(() => vi.unstubAllGlobals())

describe('one classified retry owner', () => {
  it.each([[503, 2], [404, 1], [401, 1], [422, 1]])('makes %s HTTP failures use exactly %s attempts', async (status, expected) => {
    let requests = 0
    const fetch = createFetch({ fetch: async () => { requests++; return new Response(JSON.stringify({ code: 'unavailable', message: 'failure' }), { status, headers: { 'content-type': 'application/json' } }) } })
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: () => false, locale: Vue.ref('en') }))
    const { $api } = useApi()
    const { client } = plugin()
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } })
    await expect(client.fetchQuery({ queryKey: ['retry', status], queryFn: () => $api('/api/v1/probe') })).rejects.toBeInstanceOf(ApiError)
    expect(requests).toBe(expected)
    client.clear()
  })

  it('public token refusals do not bootstrap private identity recovery', async () => {
    const view = plugin(true, true)
    await expect(view.client.fetchQuery({ queryKey: ['public-token'], queryFn: async () => { throw new ApiError(401, 'unauthorized', 'Expired link') } })).rejects.toBeInstanceOf(ApiError)
    expect(view.identityRefreshes()).toBe(0)
    view.client.clear()
  })

  it('does not retry cancelled reads', async () => {
    let requests = 0
    vi.stubGlobal('$fetch', createFetch({ fetch: async () => { requests++; throw new DOMException('Cancelled', 'AbortError') } }))
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: () => false, locale: Vue.ref('en') }))
    const { $api } = useApi()
    const { client } = plugin()
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } })
    await expect(client.fetchQuery({ queryKey: ['aborted'], queryFn: () => $api('/api/v1/probe') })).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toBe(1)
    client.clear()
  })

  it('does not retry schema violations', async () => {
    const { client } = plugin()
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } })
    let requests = 0
    await expect(client.fetchQuery({ queryKey: ['schema'], queryFn: () => { requests++; throw Object.assign(new Error('bad payload'), { name: 'ZodError' }) } })).rejects.toThrow('bad payload')
    expect(requests).toBe(1)
    client.clear()
  })

  it('does not automatically refetch a deterministic SSR failure after hydration', async () => {
    const { client, hooks } = plugin(true)
    let requests = 0
    client.getQueryCache().build(client, { queryKey: ['missing'] }).setState({ status: 'error', error: new ApiError(404, 'not_found', 'missing'), fetchStatus: 'idle' })
    const observer = new Query.QueryObserver(client, { queryKey: ['missing'], retryOnMount: false, queryFn: async () => { requests++; throw new ApiError(404, 'not_found', 'missing') } })
    const unsubscribe = observer.subscribe(() => {})
    await hooks.get('app:suspense:resolve')!()
    expect(requests).toBe(0)
    unsubscribe(); client.clear()
  })
})
