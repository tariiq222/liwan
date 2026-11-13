import { computed, ref, type ComputedRef } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { deriveCustomerCapabilities } from '../utils/customerCapabilities'
import { dismissNotice, isNoticeDismissed, noticeStorage, selectNotice, type NoticeSubscription, type ShellNotice } from '../utils/shellNotices'

const SUBSCRIPTION_STALE_MS = 5 * 60_000

/**
 * The one subscription notice for the shell, or null. Inputs come from `/me`; the subscription view is read only for a
 * user who derives `subscription.read`, only in `saas`, and only after hydration, so a plain member never causes the
 * request and the page never waits on it. The result is cached per user and company by the query client.
 * It is not mounted in any layout yet: a layout renders `notice` and calls `dismiss`.
 */
export function useShellNotice(): { notice: ComputedRef<ShellNotice | null>, dismiss: (notice: ShellNotice) => void } {
  const { me } = useMe()
  const hydrated = useHydrated()
  const api = useSubscriptionApi()
  const saas = computed(() => me.value !== null && me.value.commercial?.mode !== 'non_saas')
  const capabilities = computed(() => deriveCustomerCapabilities(me.value?.capabilities))
  // The same rule as the subscription page: a read-only user keeps no manage right.
  const canRead = computed(() => capabilities.value.includes('subscription.read'))
  const canManage = computed(() => !me.value?.read_only && capabilities.value.includes('subscription.manage'))
  const subscription = useQuery({
    queryKey: computed(() => ['shell', 'subscription', me.value?.company.id ?? null, me.value?.id ?? null]),
    queryFn: async (): Promise<NoticeSubscription | null> => {
      try {
        return await api.subscription()
      } catch (cause) {
        // A company with no subscription yet answers 404: nothing to announce.
        if (((cause as { statusCode?: number })?.statusCode ?? (cause as { status?: number })?.status) === 404) return null
        throw cause
      }
    },
    enabled: computed(() => hydrated.value && saas.value && canRead.value),
    staleTime: SUBSCRIPTION_STALE_MS,
    retry: false,
  })
  // Local storage is not reactive: a counter makes a dismissal take effect at once.
  const dismissals = ref(0)
  const notice = computed(() => {
    void dismissals.value
    if (!me.value || !hydrated.value) return null
    const storage = noticeStorage()
    const now = new Date()
    return selectNotice({
      now,
      commercialMode: me.value.commercial?.mode,
      platformState: me.value.platform?.state,
      userReadOnly: me.value.read_only,
      canManage: canManage.value,
      subscription: canRead.value && saas.value ? subscription.data.value ?? null : null,
      isDismissed: candidate => isNoticeDismissed(storage, candidate, now),
    })
  })
  function dismiss(target: ShellNotice) {
    dismissNotice(noticeStorage(), target, new Date())
    dismissals.value += 1
  }
  return { notice, dismiss }
}
