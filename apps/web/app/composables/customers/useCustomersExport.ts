import { useMutation } from '@tanstack/vue-query'
import { saveBlob } from '../../utils/saveBlob'
import { customerApiQuery, type CustomerListState } from './customerListParams'

export const CUSTOMERS_EXPORT_PATH = '/api/v1/customers/export'
const FALLBACK_FILENAME = 'customers.csv'

/** Downloads the customers the list shows as CSV (its search and archived filter, not its page), named by the server. */
export function useCustomersExport() {
  const { $download } = useApi()
  return useMutation({
    mutationFn: async (state: Pick<CustomerListState, 'q' | 'archived'>) => {
      const { blob, filename } = await $download(CUSTOMERS_EXPORT_PATH, { query: customerApiQuery(state) })
      saveBlob(blob, filename ?? FALLBACK_FILENAME)
    },
  })
}
