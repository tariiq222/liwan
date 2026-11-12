import { QueryCache, QueryClient, MutationCache, hydrate, dehydrate } from '@tanstack/vue-query'
import { createSessionQueryScope, sessionQueryScopeKey, type SessionQueryOwner } from '@/lib/sessionQueryScope'
import { clearChatDrafts } from '@/utils/chatDrafts'
import { companySwitching } from '@/utils/companySwitch'
import { sessionIdentityKey, isPossibleSessionExpiry, isRequestContextChanged } from '@/utils/sessionExpiry'
import { clearTenantSuspension, dropToastsWhileSuspended, isTenantSuspended, onTenantSuspension, SUSPENDED_LOGIN } from '@/utils/tenantSuspension'
import { keepBuiltInsOutOfIdTree } from '@/lib/hydrationIds'
import { restoreDehydratedErrors, serializeDehydratedErrors, settleServerQueries, retryQuery, isTransientQueryError, type SerializedDehydratedState } from '@/lib/vueQuerySsr'

// Bus and access refresh depend on this app-local owner scope.
export default defineNuxtPlugin({
  name: 'vue-query',
  setup(nuxt) {
    const vueQueryState = useState<SerializedDehydratedState | null>('vue-query')
    const router = useRouter()

    // A session that expires while a tab is open used to be invisible to the
    // router: auth.global.ts only runs on navigation, so every background
    // query kept reporting session failures. Re-check `me` once
    // (deduped below) on an actual 401 session refusal, and if
    // the session really is gone, route to /login with a `next` back here.
    // `me` is null when its last request failed; useNuxtData('me') would still
    // read the last signed-in user out of the payload and hide the expiry.
    const identity = import.meta.client ? useMe({ immediate: false }) : undefined
    let recovering = false
    function mayFinishSignOut(owner: SessionQueryOwner): boolean {
      const current = queryScope.current.value
      return current.generation === owner.generation
        || (current.generation === owner.generation + 1 && current.identity === 'anonymous' && !current.publicView)
    }
    function onMaybeExpiredSession(generation: number, error: unknown) {
      if (!identity || recovering || queryScope.current.value.generation !== generation || router.currentRoute.value.meta.access || !isPossibleSessionExpiry(error)) return
      const owner = queryScope.current.value
      recovering = true
      // runWithContext: these callbacks fire from vue-query's cache, outside
      // any component setup, so the Nuxt composables below need the app
      // context restored explicitly.
      Promise.resolve(nuxt.runWithContext(async () => {
        await identity.refresh()
        if (identity.ownershipIdentity.value !== null || !mayFinishSignOut(owner)) return // still signed in, or another owner replaced it
        clearChatDrafts()
        // The next sign-in may be another user: nothing cached for this one survives the session.
        queryScope.current.value.client.clear()
        const current = router.currentRoute.value
        // Login (guest) and the public pages (pay page, invitation) have no session to lose.
        if (current.meta.access) return
        // A suspension reported while `me` was re-checked owns the redirect and its reason.
        if (isTenantSuspended()) return
        await navigateTo({ path: '/login', query: { next: current.fullPath } })
      })).finally(() => { recovering = false })
    }

    // Another tab switched the working company: this one still states the old company, so the server refused
    // the request unwritten. Reload `me` (its new company disposes this tab's private views). A refused read says
    // why, once for the burst of requests that fail together; a refused write already shows the mapped message
    // in its own place. This tab's own switch is quiet: its in-flight requests still state the old company.
    let reconciling = false
    function onMaybeStaleCompany(generation: number, error: unknown, saying: boolean) {
      if (!identity || reconciling || companySwitching.value || queryScope.current.value.generation !== generation || !isRequestContextChanged(error)) return
      reconciling = true
      Promise.resolve(nuxt.runWithContext(async () => {
        await identity.refresh()
        if (saying) useToast().add({ title: nuxt.$i18n.t('errors.codes.request_context_changed'), color: 'warning' })
      })).finally(() => { reconciling = false })
    }

    const queryScope = createSessionQueryScope(generation => new QueryClient({
      defaultOptions: { queries: { staleTime: 5_000, retry: retryQuery, refetchOnWindowFocus: true, retryOnMount: import.meta.server || !nuxt.isHydrating } },
      queryCache: new QueryCache({ onError: error => { onMaybeExpiredSession(generation, error); onMaybeStaleCompany(generation, error, true) } }),
      mutationCache: new MutationCache({ onError: error => { onMaybeExpiredSession(generation, error); onMaybeStaleCompany(generation, error, false) } }),
    }), sessionIdentityKey(identity?.ownershipIdentity.value), router.currentRoute.value.meta.access === 'public' || router.currentRoute.value.meta.access === 'guest')
    nuxt.vueApp.provide(sessionQueryScopeKey, queryScope)
    const initialClient = queryScope.current.value.client
    nuxt.vueApp.onUnmount(() => { queryScope.current.value.client.clear() })
    // Restoring keeps Vue Query from replacing an SSR error with a fresh
    // pending result while Vue is attaching to that error's markup. Resume
    // normal observer subscriptions/refetching after all async pages hydrate.
    if (import.meta.client && nuxt.isHydrating) {
      const restoring = initialClient.isRestoring
      if (restoring) restoring.value = true
      nuxt.hook('app:suspense:resolve', async () => {
        if (queryScope.current.value.client !== initialClient) return
        const queryClient = initialClient
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
            && isTransientQueryError(query.state.error)
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
        const owner = queryScope.current.value
        void nuxt.runWithContext(async () => {
          clearChatDrafts()
          await owner.client.cancelQueries()
          if (!mayFinishSignOut(owner)) return
          queryScope.current.value.client.clear()
          await navigateTo(SUSPENDED_LOGIN, { replace: true })
          useToast().clear()
        })
      })
      // Mutations still in flight are not cancelled: one that fails after the redirect toasts from its own
      // onError, over the suspended login page that already states the reason.
      dropToastsWhileSuspended(useToast().toasts)
      // Signing in again starts a session the old suspension no longer describes. Only a signed-out to
      // signed-in change clears it: a late success of a request sent before the suspension does not.
      let lastResolvedOwner = identity.ownershipIdentity.value === undefined ? undefined : sessionIdentityKey(identity.ownershipIdentity.value)
      watch(identity.ownershipIdentity, me => {
        if (me === undefined) return
        const before = lastResolvedOwner
        lastResolvedOwner = sessionIdentityKey(me)
        if (me && (before === undefined || before === 'anonymous')) clearTenantSuspension()
      }, { flush: 'sync' })
      watch(
        () => ({
          identity: identity.ownershipIdentity.value === undefined ? undefined : sessionIdentityKey(identity.ownershipIdentity.value),
          publicView: router.currentRoute.value.meta.access === 'public' || router.currentRoute.value.meta.access === 'guest',
        }),
        current => queryScope.prepare(current.identity, current.publicView),
        { flush: 'sync' },
      )
    }

    // useQuery does not automatically register serverPrefetch. Let every
    // component settle the active cache entries it created before its SSR
    // subtree is rendered. This also catches queries started by child
    // components through their own mixin invocation.
    // Register on both sides: Vue uses serverPrefetch boundaries in useId.
    // The lifecycle callback itself only executes during server rendering.
    nuxt.vueApp.mixin({
      serverPrefetch: () => settleServerQueries(queryScope.current.value.client),
    })
    // Vue's own wrappers (Nuxt's client-only page <Transition>) must not join that id tree (lib/hydrationIds.ts).
    keepBuiltInsOutOfIdTree(nuxt.vueApp)
    if (import.meta.server) {
      nuxt.hooks.hook('app:rendered', () => {
        vueQueryState.value = serializeDehydratedErrors(dehydrate(queryScope.current.value.client, {
          // An SSR error is part of the rendered tree just like successful
          // data. Carry it to the first client result so error/empty branches
          // do not switch during hydration; Vue Query will still refetch it
          // according to the normal mount policy.
          shouldDehydrateQuery: query => query.state.status === 'success' || query.state.status === 'error',
        }))
      })
    }
    if (import.meta.client && vueQueryState.value) {
      hydrate(initialClient, restoreDehydratedErrors(vueQueryState.value))
    }
  },
})
