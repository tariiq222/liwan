import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { LookupListSchema } from '@liwan/contracts'

/** Countries matching `q` (name or code), for the nationality picker of the employee form. */
export function useHrCountries(q: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['hr', 'countries', toValue(q)] as const),
    queryFn: () => $api('/api/v1/hr/countries', { query: { q: toValue(q) || undefined, limit: 50 }, schema: LookupListSchema }),
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
  })
}
