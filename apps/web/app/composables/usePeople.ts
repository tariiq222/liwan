import type { Ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { PersonRefSchema } from '@nasq/contracts'

const PersonListSchema = PersonRefSchema.array()

export function usePeople(q: Ref<string>, enabled: Ref<boolean> = ref(true)) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['people', q.value] as const),
    // No minimum-length gate: an empty query still returns a usable "everyone"
    // list. Callers that pick from a fixed list pass `enabled: false`.
    enabled,
    queryFn: () => $api('/api/v1/people', { query: { q: q.value || undefined, limit: 50 }, schema: PersonListSchema }),
  })
}
