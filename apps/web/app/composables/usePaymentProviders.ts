import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  PaymentProviderListSchema,
  PaymentProviderSchema,
  PaymentProviderSyncSchema,
  type PaymentProvider,
  type PaymentProviderList,
  type PaymentProviderUpdate,
} from '@webvue/contracts'
import { replaceProvider } from './paymentProviders'

export const paymentProviderKeys = {
  all: ['payments', 'providers'] as const,
}

export function usePaymentProviders(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: paymentProviderKeys.all,
    enabled,
    queryFn: () => $api('/api/v1/payments/providers', { schema: PaymentProviderListSchema }),
    retry: false,
  })
}

// The server's answer replaces the cached gateway outright. An older list read still in flight is cancelled first,
// so it cannot bring the previous state back over the answer.
function useStoreProvider() {
  const qc = useQueryClient()
  return async (provider: PaymentProvider) => {
    await qc.cancelQueries({ queryKey: paymentProviderKeys.all, exact: true })
    qc.setQueryData<PaymentProviderList>(paymentProviderKeys.all, list => (list ? replaceProvider(list, provider) : list))
  }
}

/** Switch a gateway's mode, enter its keys, or both. The keys are write-only: the answer says which are set, never their values. */
export function useUpdatePaymentProvider() {
  const { $api } = useApi()
  const store = useStoreProvider()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PaymentProviderUpdate }) =>
      $api(`/api/v1/payments/providers/${id}`, { method: 'PATCH', body, schema: PaymentProviderSchema }),
    onSuccess: store,
  })
}

/** Check the stored keys against the gateway. The answer carries the refreshed gateway (its active methods may change). */
export function useSyncPaymentProvider() {
  const { $api } = useApi()
  const store = useStoreProvider()
  return useMutation({
    mutationFn: (id: number) =>
      $api(`/api/v1/payments/providers/${id}/sync`, { method: 'POST', body: {}, schema: PaymentProviderSyncSchema }),
    onSuccess: ({ provider }) => store(provider),
  })
}
