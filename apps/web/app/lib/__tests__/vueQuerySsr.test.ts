import { describe, expect, it } from 'vitest'
import { createSSRApp, h, ref, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, stringify } from 'devalue'
import { QueryClient, VueQueryPlugin, dehydrate, hydrate, useQuery } from '@tanstack/vue-query'
import { ApiError } from '../../composables/useApi'
import { restoreDehydratedErrors, serializeDehydratedErrors, settleServerQueries, useSsrQuerySeed } from '../vueQuerySsr'

type FakeQuery = {
  promise?: Promise<unknown>
  state: { fetchStatus: 'fetching' | 'idle'; status: 'pending' | 'success' | 'error' }
}

function fakeClient(queries: FakeQuery[]): QueryClient {
  return {
    getQueryCache: () => ({ getAll: () => queries }),
  } as unknown as QueryClient
}

describe('settleServerQueries', () => {
  it('keeps delayed SSR data in agreement with the hydrated client cache', async () => {
    const serverClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Root = {
      setup() {
        const query = useQuery({
          queryKey: ['hydration-regression'],
          queryFn: async () => {
            await new Promise(resolve => setTimeout(resolve, 5))
            return 'server data'
          },
        })
        return { query }
      },
      template: '<p>{{ query.data || "loading" }}</p>',
    }
    const app = createSSRApp(Root)
    app.use(VueQueryPlugin, { queryClient: serverClient })
    app.mixin({ serverPrefetch: () => settleServerQueries(serverClient) })

    const html = await renderToString(app)
    const state = dehydrate(serverClient)
    const clientClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    hydrate(clientClient, state)

    expect(html).toContain('server data')
    expect(clientClient.getQueryData(['hydration-regression'])).toBe('server data')
  })

  it('seeds a ref after SSR query settlement when an immediate watcher cannot rerun', async () => {
    const serverClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Root = {
      setup() {
        const query = useQuery({
          queryKey: ['hydration-ref-regression'],
          queryFn: async () => 'server field value',
        })
        const field = ref('')
        watch(query.data, data => { if (data) field.value = data }, { immediate: true })
        useSsrQuerySeed(query, data => { field.value = data })
        return { field }
      },
      template: '<input :value="field">',
    }
    const app = createSSRApp(Root)
    app.use(VueQueryPlugin, { queryClient: serverClient })
    app.mixin({ serverPrefetch: () => settleServerQueries(serverClient) })

    expect(await renderToString(app)).toContain('value="server field value"')
  })

  it('renders a new form with a disabled optional query without fetching or hanging', async () => {
    const client = new QueryClient()
    let fetched = false
    const app = createSSRApp({
      setup() {
        const query = useQuery({ queryKey: ['optional-series'], enabled: false, queryFn: async () => { fetched = true; return 'series' } })
        const field = ref('new form')
        useSsrQuerySeed(query, value => { field.value = value })
        return { field }
      },
      template: '<p>{{ field }}</p>',
    })
    app.use(VueQueryPlugin, { queryClient: client })
    app.mixin({ serverPrefetch: () => settleServerQueries(client) })
    expect(await renderToString(app)).toContain('new form')
    expect(fetched).toBe(false)
  })

  it('waits for delayed data and a query enabled by that result', async () => {
    const queries: FakeQuery[] = []
    const dependent: FakeQuery = {
      state: { fetchStatus: 'fetching', status: 'pending' },
      promise: Promise.resolve().then(() => { dependent.state = { fetchStatus: 'idle', status: 'success' } }),
    }
    const parent: FakeQuery = {
      state: { fetchStatus: 'fetching', status: 'pending' },
      promise: new Promise<void>(resolve => setTimeout(resolve, 5)).then(() => {
        parent.state = { fetchStatus: 'idle', status: 'success' }
        queries.push(dependent)
      }),
    }
    queries.push(parent)

    await settleServerQueries(fakeClient(queries))

    expect(parent.state.status).toBe('success')
    expect(dependent.state.status).toBe('success')
  })

  it('contains query failures so the error result can be rendered and dehydrated', async () => {
    const failed: FakeQuery = {
      state: { fetchStatus: 'fetching', status: 'pending' },
      promise: Promise.reject(new Error('request failed')).catch(() => {
        failed.state = { fetchStatus: 'idle', status: 'error' }
      }),
    }

    await expect(settleServerQueries(fakeClient([failed]))).resolves.toBeUndefined()
    expect(failed.state.status).toBe('error')
  })

  it('preserves structured API errors across the SSR payload boundary', async () => {
    const source = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(source.fetchQuery({
      queryKey: ['structured-error'],
      queryFn: async () => { throw new ApiError(403, 'forbidden', 'Not allowed') },
    })).rejects.toBeInstanceOf(ApiError)

    const dehydrated = serializeDehydratedErrors(dehydrate(source, {
      shouldDehydrateQuery: query => query.state.status === 'error',
    }))
    const restored = restoreDehydratedErrors(parse(stringify(dehydrated)) as typeof dehydrated)
    const error = restored.queries[0]?.state.error
    const failureReason = restored.queries[0]?.state.fetchFailureReason

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Not allowed' })
    expect(failureReason).toBeInstanceOf(ApiError)
    expect(failureReason).toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('keeps the SSR error branch stable while the client restores its query cache', async () => {
    const server = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Component = {
      setup() {
        const query = useQuery({ queryKey: ['missing-record'], queryFn: async () => { throw new ApiError(404, 'not_found', 'Record not found') } })
        return () => h('p', query.error.value?.message ?? 'loading')
      },
    }
    const app = createSSRApp(Component)
    app.use(VueQueryPlugin, { queryClient: server })
    app.mixin({ serverPrefetch: () => settleServerQueries(server) })
    const html = await renderToString(app)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    client.isRestoring!.value = true
    hydrate(client, restoreDehydratedErrors(parse(stringify(serializeDehydratedErrors(dehydrate(server, { shouldDehydrateQuery: () => true }))))))
    const firstClientTree = createSSRApp(Component)
    firstClientTree.use(VueQueryPlugin, { queryClient: client })
    expect(html).toContain('Record not found')
    expect(await renderToString(firstClientTree)).toBe(html)
    expect(client.isFetching()).toBe(0)
  })

  it('does not wait for disabled or already settled queries', async () => {
    const disabled: FakeQuery = { state: { fetchStatus: 'idle', status: 'pending' } }
    await expect(settleServerQueries(fakeClient([disabled]))).resolves.toBeUndefined()
    expect(disabled.state.fetchStatus).toBe('idle')
  })
})
