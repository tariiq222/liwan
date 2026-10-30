import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceJournalListSchema,
  JournalEntryDetailSchema,
  JournalEntryListSchema,
  type JournalEntryCreate,
  type JournalEntryPatch,
} from '@liwan/contracts'
import type { EntryListParams } from '@/components/finance/accounting/entryListParams'

export const financeEntryKeys = {
  all: ['finance', 'entries'] as const,
  list: (params: EntryListParams) => ['finance', 'entries', 'list', params] as const,
  record: (id: number) => ['finance', 'entries', 'record', id] as const,
  journals: ['finance', 'journals', 'general'] as const,
}

/** One page of manual entries; the KPI counts ask for the same list with `limit=1` and read only its total. */
export function useFinanceEntryList(params: MaybeRefOrGetter<EntryListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeEntryKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/entries', { query: { ...toValue(params) }, schema: JournalEntryListSchema }),
  })
}

export function useFinanceEntry(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeEntryKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/entries/${toValue(id)}`, { schema: JournalEntryDetailSchema }),
  })
}

/** The general journals manual entries are booked in: the list filter and the create form choose among them. */
export function useFinanceGeneralJournals(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeEntryKeys.journals,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/journals', { query: { type: 'general', limit: 100 }, schema: FinanceJournalListSchema }),
  })
}

function useEntryWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: every list, KPI count and record refreshes from the answer.
    onSuccess: () => qc.invalidateQueries({ queryKey: financeEntryKeys.all }),
  })
}

export function useCreateJournalEntry() {
  const { $api } = useApi()
  return useEntryWrite((body: JournalEntryCreate) => $api('/api/v1/finance/entries', { method: 'POST', body, schema: JournalEntryDetailSchema }))
}

export function usePatchJournalEntry() {
  const { $api } = useApi()
  return useEntryWrite(({ id, body }: { id: number; body: JournalEntryPatch }) =>
    $api(`/api/v1/finance/entries/${id}`, { method: 'PATCH', body, schema: JournalEntryDetailSchema }))
}

export function useDeleteJournalEntry() {
  const { $api } = useApi()
  return useEntryWrite((id: number) => $api(`/api/v1/finance/entries/${id}`, { method: 'DELETE' }))
}

export type FinanceEntryTransition = 'post' | 'reset-to-draft' | 'unreconcile'

export function useFinanceEntryTransition() {
  const { $api } = useApi()
  return useEntryWrite(({ id, action }: { id: number; action: FinanceEntryTransition }) =>
    $api(`/api/v1/finance/entries/${id}/${action}`, { method: 'POST', body: {}, schema: JournalEntryDetailSchema }))
}
