import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import { beginAccessRefreshInFlight, drainAccessRefreshInFlight, type AccessRefreshInFlightState } from '../composables/useAdminUsers'

export default defineNuxtPlugin({
  name: 'access-refresh',
  dependsOn: ['vue-query'],
  setup() {
    const { me, refresh } = useMe()
    const qc = useQueryClient()
    const state: AccessRefreshInFlightState = { inFlight: null }

    watch(
      () => JSON.stringify([me.value?.id, me.value?.company.id, me.value?.access_policy_version, me.value?.capabilities ?? []]),
      (_, previous) => {
        if (previous === undefined) return
        beginAccessRefreshInFlight(state, async () => {
          await nextTick()
          await qc.cancelQueries()
          await qc.resetQueries()
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
