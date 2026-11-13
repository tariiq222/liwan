import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { CustomerListSchema } from '@liwan/contracts'
import { customerKeys } from './customerKeys'

export const COMPANY_PICKER_LIMIT = 20

/** The company customers whose name, phone or email match `q`: the parents a contact person may belong to. */
export function useCustomerCompanies(q: MaybeRefOrGetter<string>, limit: number = COMPANY_PICKER_LIMIT) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => customerKeys.list({ companies: true, q: toValue(q), limit })),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/customers', {
      query: { is_company: 'true', ...(toValue(q).trim() ? { q: toValue(q).trim() } : {}), limit },
      schema: CustomerListSchema,
    }),
  })
}
