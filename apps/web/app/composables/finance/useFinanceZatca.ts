import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FinanceZatcaJournalSchema, FinanceZatcaStatusSchema, type FinanceZatcaOnboardInput } from '@webvue/contracts'
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
