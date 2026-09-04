import type { DehydratedState, VueQueryPluginOptions } from '@tanstack/vue-query'
import { VueQueryPlugin, QueryCache, QueryClient, MutationCache, hydrate, dehydrate } from '@tanstack/vue-query'
import { ApiError } from '@/composables/useApi'

// Domain-level 403s: the request was understood, the *action* is not allowed
// for this user. They must surface as a toast where they happen, never as a
// logout — only an expired/absent session should send the tab to /login.
const AUTHORIZED_403_CODES = new Set(['transition_forbidden'])

function isPossibleSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && !AUTHORIZED_403_CODES.has(error.code)
}

// Named so bus.client.ts can declare `dependsOn: ['vue-query']` - it calls
// useQueryClient() and must not run before this plugin has registered
// VueQueryPlugin on the Vue app.
export default defineNuxtPlugin({
  name: 'vue-query',
  setup(nuxt) {
    const vueQueryState = useState<DehydratedState | null>('vue-query')
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
      defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
      queryCache: new QueryCache({ onError: onMaybeExpiredSession }),
      mutationCache: new MutationCache({ onError: onMaybeExpiredSession }),
    })
    const options: VueQueryPluginOptions = { queryClient }
    nuxt.vueApp.use(VueQueryPlugin, options)

    if (import.meta.server) {
      nuxt.hooks.hook('app:rendered', () => { vueQueryState.value = dehydrate(queryClient) })
    }
    if (import.meta.client && vueQueryState.value) {
      hydrate(queryClient, vueQueryState.value)
    }
  },
})
