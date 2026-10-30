import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FinanceZatcaJournalSchema, FinanceZatcaWaitingDocumentListSchema, FinanceZatcaStatusSchema, type FinanceZatcaOnboardInput } from '@liwan/contracts'
import { financeSetupKey } from './useFinanceSetup'

export const financeZatcaStatusKey = ['finance', 'zatca', 'status'] as const

/** The onboarding readiness of the sales journals and the submission backlog. */
export function useFinanceZatcaStatus(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeZatcaStatusKey,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/zatca/status', { schema: FinanceZatcaStatusSchema }),
  })
}

/** Onboarding a journal changes the readiness shown here and in the finance setup page. */
export function useOnboardZatcaJournal() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ journalId, otp }: { journalId: number } & FinanceZatcaOnboardInput) =>
      $api(`/api/v1/finance/zatca/journals/${journalId}/onboard`, { method: 'POST', body: { otp }, schema: FinanceZatcaJournalSchema }),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeZatcaStatusKey }),
      qc.invalidateQueries({ queryKey: financeSetupKey }),
      qc.invalidateQueries({ queryKey: ['finance', 'audit'] }),
    ]),
  })
}

export const ZATCA_WAITING_PAGE_SIZE = 25

/** The e-invoices ZATCA has not accepted, oldest first; `state` narrows them to one waiting state. */
export function useFinanceZatcaWaitingDocuments(params: MaybeRefOrGetter<{ state: string | null; page: number }>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['finance', 'zatca', 'documents', toValue(params)] as const),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const { state, page } = toValue(params)
      return $api('/api/v1/finance/zatca/documents', {
        query: { ...(state ? { state } : {}), limit: ZATCA_WAITING_PAGE_SIZE, offset: (page - 1) * ZATCA_WAITING_PAGE_SIZE },
        schema: FinanceZatcaWaitingDocumentListSchema,
      })
    },
  })
}
