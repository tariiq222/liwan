import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CustomerListSchema, CustomerSchema, type Customer, type CustomerCreate, type CustomerPatch } from '@liwan/contracts'
import { customerKeys } from './customerKeys'
import { CUSTOMER_PAGE_SIZE, customerApiQuery, type CustomerListState } from './customerListParams'

export type { Customer }

export function useCustomers(state: MaybeRefOrGetter<CustomerListState>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => customerKeys.list(toValue(state))),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const current = toValue(state)
      return $api('/api/v1/customers', {
        query: { ...customerApiQuery(current), limit: CUSTOMER_PAGE_SIZE, offset: (current.page - 1) * CUSTOMER_PAGE_SIZE },
        schema: CustomerListSchema,
      })
    },
  })
}

export function useCustomer(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => customerKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/customers/${toValue(id)}`, { schema: CustomerSchema }),
  })
}

/** Every write answers the customer as saved: it replaces the record's cache entry and refreshes the lists. */
function useCustomerWrite<Args>(send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<Customer>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved) => {
      qc.setQueryData(customerKeys.detail(saved.id), saved)
      await qc.invalidateQueries({ queryKey: [...customerKeys.all, 'list'] })
    },
  })
}

export const useCreateCustomer = () => useCustomerWrite<CustomerCreate>(
  (api, body) => api('/api/v1/customers', { method: 'POST', body, schema: CustomerSchema }),
)

export const useUpdateCustomer = () => useCustomerWrite<{ id: number; patch: CustomerPatch }>(
  (api, { id, patch }) => api(`/api/v1/customers/${id}`, { method: 'PATCH', body: patch, schema: CustomerSchema }),
)

export const useArchiveCustomer = () => useCustomerWrite<number>(
  (api, id) => api(`/api/v1/customers/${id}/archive`, { method: 'POST', schema: CustomerSchema }),
)

export const useRestoreCustomer = () => useCustomerWrite<number>(
  (api, id) => api(`/api/v1/customers/${id}/restore`, { method: 'POST', schema: CustomerSchema }),
)
