import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { PaymentSettingsSchema, type PaymentSettingsUpdate } from '@liwan/contracts'

/** The settings belong to the current company (the expiry), so each company keeps its own cache entry. */
export const paymentSettingsKeys = {
  company: (companyId: number | undefined) => ['payments', 'settings', { companyId }] as const,
}

export function usePaymentSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => paymentSettingsKeys.company(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/payments/settings', { schema: PaymentSettingsSchema }),
    retry: false,
  })
}

/**
 * One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. The server's
 * answer replaces the cached settings outright; an older read still in flight is cancelled first so it cannot bring the
 * previous values back.
 */
export function useSavePaymentSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: PaymentSettingsUpdate) => {
      const key = paymentSettingsKeys.company(me.value?.company?.id)
      const saved = await $api('/api/v1/payments/settings', { method: 'PATCH', body, schema: PaymentSettingsSchema })
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      return saved
    },
  })
}
