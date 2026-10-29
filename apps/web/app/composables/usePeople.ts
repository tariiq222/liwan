import type { Ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { PersonRefSchema } from '@webvue/contracts'

const PersonListSchema = PersonRefSchema.array()

export const PEOPLE_ENDPOINT = '/api/v1/people'

/** The cache key and request query of one person search; two endpoints never share cached results. */
export function peopleSearch(endpoint: string, q: string) {
  return { key: ['people', endpoint, q] as const, query: { q: q || undefined, limit: 50 } }
}

// `endpoint` is another route answering the same person list (for example the people one application accepts for a role).
export function usePeople(q: Ref<string>, enabled: Ref<boolean> = ref(true), endpoint: Ref<string> = ref(PEOPLE_ENDPOINT)) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => peopleSearch(endpoint.value, q.value).key),
    // No minimum-length gate: an empty query still returns a usable "everyone"
    // list. Callers that pick from a fixed list pass `enabled: false`.
    enabled,
    queryFn: () => $api(endpoint.value, { query: peopleSearch(endpoint.value, q.value).query, schema: PersonListSchema }),
  })
}
