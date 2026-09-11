import type { VueQueryPluginOptions } from '@tanstack/vue-query'
import { VueQueryPlugin, QueryCache, QueryClient, MutationCache, hydrate, dehydrate } from '@tanstack/vue-query'
import { ApiError } from '@/composables/useApi'
import { restoreDehydratedErrors, serializeDehydratedErrors, settleServerQueries, type SerializedDehydratedState } from '@/lib/vueQuerySsr'

// Domain-level 403s: the request was understood, the *action* is not allowed
// for this user. They must surface as a toast where they happen, never as a
// logout — only an expired/absent session should send the tab to /login.
const AUTHORIZED_403_CODES = new Set(['transition_forbidden', 'status_forbidden'])

function isPossibleSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && !AUTHORIZED_403_CODES.has(error.code)
}

// Named so bus.client.ts can declare `dependsOn: ['vue-query']` - it calls
// useQueryClient() and must not run before this plugin has registered
// VueQueryPlugin on the Vue app.
export default defineNuxtPlugin({
  name: 'vue-query',
  setup(nuxt) {
    const vueQueryState = useState<SerializedDehydratedState | null>('vue-query')
    const router = useRouter()

    // A session that expires while a tab is open used to be invisible to the
    // router: auth.global.ts only runs on navigation, so every background
    // query just 403'd and toasted "forbidden" forever. Re-check `me` once
    // (deduped below) on any 403 that isn't a known domain-level one, and if
    // the session really is gone, route to /login with a `next` back here.
    let recovering = false
    function onMaybeExpiredSession(error: unknown) {
      if (!import.meta.client || recovering || !isPossibleSessionExpiry(error)) return
      recovering = true
      // runWithContext: these callbacks fire from vue-query's cache, outside
      // any component setup, so the Nuxt composables below need the app
      // context restored explicitly.
      Promise.resolve(nuxt.runWithContext(async () => {
        await refreshNuxtData('me')
        const { data } = useNuxtData<unknown>('me')
        if (data.value) return // still signed in: a genuine permission error
        const current = router.currentRoute.value
        if (current.path === '/login') return
        await navigateTo({ path: '/login', query: { next: current.fullPath } })
      })).finally(() => { recovering = false })
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true, retryOnMount: import.meta.server || !nuxt.isHydrating } },
      queryCache: new QueryCache({ onError: onMaybeExpiredSession }),
      mutationCache: new MutationCache({ onError: onMaybeExpiredSession }),
    })
    // Restoring keeps Vue Query from replacing an SSR error with a fresh
    // pending result while Vue is attaching to that error's markup. Resume
    // normal observer subscriptions/refetching after all async pages hydrate.
    if (import.meta.client && nuxt.isHydrating) {
      const restoring = queryClient.isRestoring
      if (restoring) restoring.value = true
      nuxt.hook('app:suspense:resolve', async () => {
        const defaults = queryClient.getDefaultOptions()
        queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retryOnMount: true } })
        if (restoring) restoring.value = false
        await nextTick()
        // Restoring subscriptions precedes the observer-options watcher. An
        // error can therefore skip its initial mount retry; resume it once,
        // after options settle, respecting explicit per-query opt-outs.
        await queryClient.refetchQueries({
          type: 'active',
          predicate: query => query.state.status === 'error'
            && query.state.fetchStatus === 'idle'
            && query.observers.some(({ options }) => options.retryOnMount !== false
              && (typeof options.enabled === 'function' ? options.enabled(query) : options.enabled) !== false),
        })
      })
    }
    const options: VueQueryPluginOptions = { queryClient }
    nuxt.vueApp.use(VueQueryPlugin, options)

    // useQuery does not automatically register serverPrefetch. Let every
    // component settle the active cache entries it created before its SSR
    // subtree is rendered. This also catches queries started by child
    // components through their own mixin invocation.
    // Register on both sides: Vue uses serverPrefetch boundaries in useId.
    // The lifecycle callback itself only executes during server rendering.
    nuxt.vueApp.mixin({
      serverPrefetch: () => settleServerQueries(queryClient),
    })
    if (import.meta.server) {
      nuxt.hooks.hook('app:rendered', () => {
        vueQueryState.value = serializeDehydratedErrors(dehydrate(queryClient, {
          // An SSR error is part of the rendered tree just like successful
          // data. Carry it to the first client result so error/empty branches
          // do not switch during hydration; Vue Query will still refetch it
          // according to the normal mount policy.
          shouldDehydrateQuery: query => query.state.status === 'success' || query.state.status === 'error',
        }))
      })
    }
    if (import.meta.client && vueQueryState.value) {
      hydrate(queryClient, restoreDehydratedErrors(vueQueryState.value))
    }
  },
})
