import { useQueries } from '@tanstack/vue-query'
import { personalAction, personalEntries } from './nav/personalModel'

/** Each summary is owned by its application and keyed by employee identity and company. */
export function usePersonalOverview() {
  const { me } = useMe()
  const { $api } = useApi()
  const { t, locale } = useI18n()
  const hydrated = useHydrated()
  const entries = computed(() => personalEntries(me.value))
  const providers = computed(() => entries.value.filter(entry => entry.summary))
  const results = useQueries({
    queries: computed(() => providers.value.map(entry => ({
      queryKey: [...entry.summary!.queryKey, 'self-service', me.value?.company.id, me.value?.id, locale.value],
      enabled: hydrated.value && !!me.value,
      queryFn: ({ signal }: { signal: AbortSignal }) => entry.summary!.load((url, options) => $api(url, { ...options, signal }), t),
    }))),
  })
  const cards = computed(() => entries.value.map(entry => {
    const query = results.value[providers.value.findIndex(provider => provider.id === entry.id)]
    return { entry, data: query?.data, pending: !!query?.isPending, error: query?.error, action: personalAction(entry, me.value), retry: () => query?.refetch() }
  }))
  return { cards, attention: computed(() => cards.value.flatMap(card => card.data?.attention ?? [])) }
}
