import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HrExpiringListSchema, HrSaudizationSchema } from '@liwan/contracts'

/** The look-ahead windows the expiry report offers, in days; the first is the default. */
export const HR_EXPIRY_WINDOWS = [30, 60, 90] as const
export type HrExpiryWindow = (typeof HR_EXPIRY_WINDOWS)[number]

export const hrReportKeys = {
  saudization: ['hr', 'reports', 'saudization'] as const,
  expiring: (withinDays: HrExpiryWindow) => ['hr', 'reports', 'expiring', withinDays] as const,
}

/** The window named by `?within=`; anything else (unknown value, repeated key) is the default. */
export function hrExpiryWindowFrom(value: unknown): HrExpiryWindow {
  return HR_EXPIRY_WINDOWS.find(window => String(window) === value) ?? HR_EXPIRY_WINDOWS[0]
}

export function useHrSaudization(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrReportKeys.saudization,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/saudization', { schema: HrSaudizationSchema }),
  })
}

export function useHrExpiring(withinDays: MaybeRefOrGetter<HrExpiryWindow>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrReportKeys.expiring(toValue(withinDays))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/expiring', {
      query: { within_days: toValue(withinDays) },
      schema: HrExpiringListSchema,
    }),
  })
}
