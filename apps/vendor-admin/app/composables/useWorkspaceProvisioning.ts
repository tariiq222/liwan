import type { Ref } from 'vue'
import { sharedTenantLoginUrl, type SharedTenantProgress } from '@/composables/useSharedTenantOnboarding'

const POLL_INTERVAL_MS = 5000
const POLL_LIMIT = 60
const PROVISIONING_STAGES = ['reserved', 'queued', 'verifying', 'activating', 'active', 'needs_intervention']

/** Shared-workspace provisioning progress of one tenant (none for an empty id), checked every five seconds while it is still in progress. */
export function useWorkspaceProvisioning(id: Ref<string>) {
  const { request } = useVendorApi()
  const vendorContext = useVendorContext()
  const { data: provisioning, error, pending, refresh } = useAsyncData(
    () => `vendor:tenant-provisioning:${id.value}`,
    async () => {
      if (!id.value || !vendorContext.sharedOnboardingEnabled.value) return null
      try { return await request<SharedTenantProgress>(`shared/tenants/${encodeURIComponent(id.value)}/provisioning`) }
      catch (cause) {
        const failure = cause as { statusCode?: number; status?: number; response?: { status?: number } }
        if ((failure.statusCode ?? failure.status ?? failure.response?.status) === 404) return null
        throw cause
      }
    },
  )
  const loginUrl = computed(() => error.value ? null : sharedTenantLoginUrl(provisioning.value))
  const failed = computed(() => ['failed', 'needs_intervention'].includes(provisioning.value?.status ?? '') || Boolean(provisioning.value?.error_code))
  const active = computed(() => Boolean(provisioning.value && !loginUrl.value && !failed.value))
  const stage = computed(() => {
    const current = provisioning.value?.stage
    return current && PROVISIONING_STAGES.includes(current) ? current : 'pending'
  })
  const pollCount = ref(0)
  const pollingPaused = computed(() => active.value && pollCount.value >= POLL_LIMIT)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  function stopPoll() { if (timer) clearTimeout(timer); timer = undefined }
  function schedulePoll() {
    stopPoll()
    if (!import.meta.client || disposed || !active.value || error.value || pollCount.value >= POLL_LIMIT) return
    timer = setTimeout(async () => {
      pollCount.value++
      await refresh()
      schedulePoll()
    }, POLL_INTERVAL_MS)
  }
  async function refreshNow() {
    pollCount.value = 0
    await refresh()
    schedulePoll()
  }
  watch(id, () => { pollCount.value = 0; stopPoll() })
  watch([active, error], schedulePoll)
  onMounted(schedulePoll)
  onBeforeUnmount(() => { disposed = true; stopPoll() })
  return { provisioning, error, pending, loginUrl, failed, active, stage, pollingPaused, refreshNow }
}
