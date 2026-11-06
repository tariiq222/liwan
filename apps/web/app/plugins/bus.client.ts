import { useSessionQueryScope } from '../lib/sessionQueryScope'
import { setBusQueryClient } from '../composables/useBus'

// Client-only: opens exactly one bus WebSocket per tab once a user is
// logged in, and tears it down on logout. `useMe()`'s `me` query is keyed
// 'me' and shared with the rest of the app (middleware, shell/AppSidebar,
// authenticated pages, and the login/logout flows' `refreshNuxtData('me')`), so this
// plugin reacts to the same login state everything else does rather than
// fetching its own copy.
//
// The active owner changes without opening a second socket. Pending bus work
// already fences its captured client before publishing invalidations.
export default defineNuxtPlugin({
  name: 'bus',
  dependsOn: ['vue-query'],
  setup() {
    const { connect, disconnect } = useBus()
    const queryScope = useSessionQueryScope()
    watch(() => queryScope.current.value.client, setBusQueryClient, { immediate: true, flush: 'sync' })
    const { loggedIn } = useMe({ immediate: false })

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
