import type { VueQueryPluginOptions } from '@tanstack/vue-query'
import { VueQueryPlugin, QueryCache, QueryClient, MutationCache, hydrate, dehydrate } from '@tanstack/vue-query'
import { clearChatDrafts } from '@/utils/chatDrafts'
import { isDifferentUser, isPossibleSessionExpiry } from '@/utils/sessionExpiry'
import { clearTenantSuspension, dropToastsWhileSuspended, isTenantSuspended, onTenantSuspension, SUSPENDED_LOGIN } from '@/utils/tenantSuspension'
import { restoreDehydratedErrors, serializeDehydratedErrors, settleServerQueries, type SerializedDehydratedState } from '@/lib/vueQuerySsr'

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
    // `me` is null when its last request failed; useNuxtData('me') would still
    // read the last signed-in user out of the payload and hide the expiry.
    const identity = import.meta.client ? useMe() : undefined
    let recovering = false
    function onMaybeExpiredSession(error: unknown) {
      if (!identity || recovering || !isPossibleSessionExpiry(error)) return
      recovering = true
      // runWithContext: these callbacks fire from vue-query's cache, outside
      // any component setup, so the Nuxt composables below need the app
      // context restored explicitly.
      Promise.resolve(nuxt.runWithContext(async () => {
        await identity.refresh()
        if (identity.me.value) return // still signed in: a genuine permission error
        clearChatDrafts()
        // The next sign-in may be another user: nothing cached for this one survives the session.
        queryClient.clear()
        const current = router.currentRoute.value
        // Login (guest) and the public pages (pay page, invitation) have no session to lose.
        if (current.meta.access) return
        // A suspension reported while `me` was re-checked owns the redirect and its reason.
        if (isTenantSuspended()) return
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
    // A tenant suspended mid-session: useApi reports the first `tenant_suspended` refusal once. Drop the
    // cached tenant data, stop the background refetches that would only fail again, and show the one
    // suspended state on the login page (the session has ended), without the toasts the failures raised.
    if (identity) {
      onTenantSuspension(() => {
        void nuxt.runWithContext(async () => {
          clearChatDrafts()
          await queryClient.cancelQueries()
          queryClient.clear()
          await navigateTo(SUSPENDED_LOGIN, { replace: true })
          useToast().clear()
        })
      })
      // Mutations still in flight are not cancelled: one that fails after the redirect toasts from its own
      // onError, over the suspended login page that already states the reason.
      dropToastsWhileSuspended(useToast().toasts)
      // Signing in again starts a session the old suspension no longer describes. Only a signed-out to
      // signed-in change clears it: a late success of a request sent before the suspension does not.
      watch(identity.me, (me, before) => { if (me && !before) clearTenantSuspension() })
      watch(identity.me, (me, before) => { if (isDifferentUser(before, me)) queryClient.clear() })
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
