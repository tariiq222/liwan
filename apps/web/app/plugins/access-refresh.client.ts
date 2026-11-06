import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { sessionIdentityKey } from '../utils/sessionExpiry'
import { useSessionQueryScope } from '../lib/sessionQueryScope'
import { beginAccessRefreshInFlight, drainAccessRefreshInFlight, type AccessRefreshInFlightState } from '../composables/useAdminUsers'

export default defineNuxtPlugin({
  name: 'access-refresh',
  dependsOn: ['vue-query'],
  setup() {
    const { ownershipIdentity, refresh } = useMe({ immediate: false })
    const queryScope = useSessionQueryScope()
    const state: AccessRefreshInFlightState = { inFlight: null }

    const snapshot = () => {
      const identity = ownershipIdentity.value
      if (identity === undefined) return undefined
      return {
        identity: sessionIdentityKey(identity),
        policy: JSON.stringify([identity?.access_policy_version, identity?.capabilities ?? []]),
      }
    }
    let previous = snapshot()
    watch(
      snapshot,
      current => {
        if (!current) return
        const before = previous
        previous = current
        if (!before || (current.identity === before.identity && current.policy === before.policy)) return
        const identityChanged = current.identity !== before.identity
        const owner = queryScope.current.value
        beginAccessRefreshInFlight(state, async () => {
          await nextTick()
          // Identity changes dispose the old private tree and create fresh observers.
          // Cancelling/resetting now would interrupt that new view's first request.
          if (identityChanged || queryScope.current.value !== owner || snapshot()?.identity !== current.identity) return
          await owner.client.cancelQueries()
          if (queryScope.current.value !== owner || snapshot()?.identity !== current.identity) return
          await owner.client.resetQueries()
        })
      },
      { flush: 'sync' },
    )

    async function waitForAccessRefresh() {
      await drainAccessRefreshInFlight(() => state.inFlight)
    }

    useEventListener(window, 'focus', () => {
      const owner = queryScope.current.value
      if (!owner.publicView && owner.identity !== 'anonymous') void refresh()
    })

    return {
      provide: {
        waitForAccessRefresh,
      },
    }
  },
})
