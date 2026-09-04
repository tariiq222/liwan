import { useQueryClient } from '@tanstack/vue-query'
import { setBusQueryClient } from '../composables/useBus'

// Client-only: opens exactly one bus WebSocket per tab once a user is
// logged in, and tears it down on logout. `useMe()`'s `me` query is keyed
// 'me' and shared with the rest of the app (middleware, AppSidebar,
// CommandMenu, the login/logout flows' `refreshNuxtData('me')`), so this
// plugin reacts to the same login state everything else does rather than
// fetching its own copy.
//
// dependsOn the named 'vue-query' plugin: this plugin calls useQueryClient()
// on setup, which throws if VueQueryPlugin hasn't been installed on the Vue
// app yet - plugin file order alone ("bus.client.ts" < "vue-query.ts") would
// run this one first, so the dependency is declared explicitly.
//
// The query client is captured here, not inside useBus() itself, because
// this file's .client.ts suffix guarantees it never runs during SSR -
// useBus() is also called from AppSidebar.vue, which does render during SSR,
// and capturing there would latch the first SSR request's query client for
// the lifetime of the Node process. See setBusQueryClient() in useBus.ts.
export default defineNuxtPlugin({
  name: 'bus',
  dependsOn: ['vue-query'],
  setup() {
    const { connect, disconnect } = useBus()
    setBusQueryClient(useQueryClient())
    const { loggedIn } = useMe()

    watch(
      loggedIn,
      (isLoggedIn) => {
        if (isLoggedIn) connect()
        else disconnect()
      },
      { immediate: true },
    )
  },
})
