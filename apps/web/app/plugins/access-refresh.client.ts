import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { sessionIdentityKey } from '../utils/sessionExpiry'
import { useSessionQueryScope } from '../lib/sessionQueryScope'
import { beginAccessRefreshInFlight, drainAccessRefreshInFlight, type AccessRefreshInFlightState } from '../composables/useAdminUsers'

export default defineNuxtPlugin({
  name: 'access-refresh',
  dependsOn: ['vue-query'],
  setup() {
    const { me, refresh } = useMe({ immediate: false })
    const queryScope = useSessionQueryScope()
    const state: AccessRefreshInFlightState = { inFlight: null }

    watch(
      () => ({
        identity: sessionIdentityKey(me.value),
        policy: JSON.stringify([me.value?.access_policy_version, me.value?.capabilities ?? []]),
      }),
      (current, previous) => {
        if (!previous || (current.identity === previous.identity && current.policy === previous.policy)) return
        const identityChanged = current.identity !== previous.identity
        const owner = queryScope.current.value
        beginAccessRefreshInFlight(state, async () => {
          await nextTick()
          // Identity changes dispose the old private tree and create fresh observers.
          // Cancelling/resetting now would interrupt that new view's first request.
          if (identityChanged || queryScope.current.value !== owner || sessionIdentityKey(me.value) !== current.identity) return
          await owner.client.cancelQueries()
          if (queryScope.current.value !== owner || sessionIdentityKey(me.value) !== current.identity) return
          await owner.client.resetQueries()
        })
      },
      { flush: 'sync' },
    )

    async function waitForAccessRefresh() {
      await drainAccessRefreshInFlight(() => state.inFlight)
    }

    useEventListener(window, 'focus', () => { if (me.value) void refresh() })

    return {
      provide: {
        waitForAccessRefresh,
      },
    }
  },
})
