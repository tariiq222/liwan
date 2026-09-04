// Client-only: opens exactly one bus WebSocket per tab once a user is
// logged in, and tears it down on logout. `useMe()`'s `me` query is keyed
// 'me' and shared with the rest of the app (middleware, AppSidebar,
// CommandMenu, the login/logout flows' `refreshNuxtData('me')`), so this
// plugin reacts to the same login state everything else does rather than
// fetching its own copy.
//
// dependsOn the named 'vue-query' plugin: useBus() calls useQueryClient()
// on first use, which throws if VueQueryPlugin hasn't been installed on the
// Vue app yet - plugin file order alone ("bus.client.ts" < "vue-query.ts")
// would run this one first, so the dependency is declared explicitly.
export default defineNuxtPlugin({
  name: 'bus',
  dependsOn: ['vue-query'],
  setup() {
    const { connect, disconnect } = useBus()
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
