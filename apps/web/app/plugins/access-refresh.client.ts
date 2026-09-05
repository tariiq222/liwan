import { useEventListener } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'

export default defineNuxtPlugin({
 name: 'access-refresh',
 dependsOn: ['vue-query'],
 setup() {
  const { me, refresh } = useMe()
  const qc = useQueryClient()
  watch(() => JSON.stringify([me.value?.id, me.value?.company.id, me.value?.access_policy_version, me.value?.capabilities ?? []]), async (_, previous) => {
    if (previous !== undefined) { await qc.cancelQueries(); await qc.resetQueries() }
  })
  useEventListener(window, 'focus', () => { if (me.value) void refresh() })
 }
})
