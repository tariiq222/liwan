import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinancePartnerBankListSchema,
  FinancePartnerBankSchema,
  type FinancePartnerBankCreate,
  type FinancePartnerBankPatch,
} from '@liwan/contracts'

export const financePartnerBankKeys = {
  list: (partnerId: number) => ['finance', 'partner', partnerId, 'bank-accounts'] as const,
}

const base = (partnerId: number) => `/api/v1/finance/partners/${partnerId}/bank-accounts`

/** Every bank account of a partner, the archived ones last. */
export function useFinancePartnerBanks(partnerId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    enabled: computed(() => toValue(enabled)),
    queryKey: computed(() => financePartnerBankKeys.list(toValue(partnerId))),
    queryFn: () => $api(base(toValue(partnerId)), { schema: FinancePartnerBankListSchema }),
  })
}

/** A write waits for the server; the list is read again from it. */
function useBankWrite<T>(partnerId: MaybeRefOrGetter<number>, request: (input: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: () => qc.invalidateQueries({ queryKey: financePartnerBankKeys.list(toValue(partnerId)) }),
  })
}

export function useCreateFinancePartnerBank(partnerId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useBankWrite(partnerId, (body: FinancePartnerBankCreate) =>
    $api(base(toValue(partnerId)), { method: 'POST', body, schema: FinancePartnerBankSchema }))
}

export function useUpdateFinancePartnerBank(partnerId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useBankWrite(partnerId, ({ id, patch }: { id: number; patch: FinancePartnerBankPatch }) =>
    $api(`${base(toValue(partnerId))}/${id}`, { method: 'PATCH', body: patch, schema: FinancePartnerBankSchema }))
}

export function useArchiveFinancePartnerBank(partnerId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useBankWrite(partnerId, ({ id, archive }: { id: number; archive: boolean }) =>
    $api(`${base(toValue(partnerId))}/${id}/${archive ? 'archive' : 'unarchive'}`, { method: 'POST', body: {}, schema: FinancePartnerBankSchema }))
}
