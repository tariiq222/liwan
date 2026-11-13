import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { CustomerCountryListSchema } from '@liwan/contracts'

/** Every country, named in the session's language. Only a manager of the settings reads it, so the caller says when. */
export function useCustomerCountries(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { locale } = useI18n()
  return useQuery({
    queryKey: computed(() => ['customers', 'countries', locale.value] as const),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/customers/settings/countries', { schema: CustomerCountryListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}
