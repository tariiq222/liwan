import type { Ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { PersonRefSchema } from '@nasq/contracts'

const PersonListSchema = PersonRefSchema.array()

export function usePeople(q: Ref<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['people', q.value] as const),
    // Always enabled: an empty query still returns a usable "everyone" list
    // for pickers, so there's no minimum-length gate here.
    enabled: true,
    queryFn: () => $api('/api/v1/people', { query: { q: q.value || undefined, limit: 50 }, schema: PersonListSchema }),
  })
}
