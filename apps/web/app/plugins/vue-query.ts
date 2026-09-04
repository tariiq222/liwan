import type { DehydratedState, VueQueryPluginOptions } from '@tanstack/vue-query'
import { VueQueryPlugin, QueryClient, hydrate, dehydrate } from '@tanstack/vue-query'

// Named so bus.client.ts can declare `dependsOn: ['vue-query']` - it calls
// useQueryClient() and must not run before this plugin has registered
// VueQueryPlugin on the Vue app.
export default defineNuxtPlugin({
  name: 'vue-query',
  setup(nuxt) {
    const vueQueryState = useState<DehydratedState | null>('vue-query')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
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
