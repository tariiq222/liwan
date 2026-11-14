import { useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  CustomerEraseResultSchema,
  CustomerErasePreviewSchema,
  type CustomerErase,
  type CustomerPrivacyExport,
} from '@liwan/contracts'
import { saveBlob } from '../../utils/saveBlob'
import { customerKeys } from './customerKeys'

const privacyPath = (id: number, route: string) => `/api/v1/customers/${id}/privacy/${route}`
const FALLBACK_FILENAME = 'customer-personal-data.xlsx'

/**
 * Loads the erase preview of one customer. Every call mints a one-time token, so this is a mutation that runs when the
 * administrator asks for the review, never a query that refetches on its own.
 */
export function useCustomerErasePreview() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(privacyPath(id, 'erase-preview'), { method: 'POST', schema: CustomerErasePreviewSchema }),
  })
}

/** Erases the customer's personal data; the record and the lists are read again afterwards. */
export function useEraseCustomer() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CustomerErase }) =>
      $api(privacyPath(id, 'erase'), { method: 'POST', body, schema: CustomerEraseResultSchema }),
    onSuccess: (_result, { id }) => qc.invalidateQueries({ queryKey: customerKeys.detail(id) })
      .then(() => qc.invalidateQueries({ queryKey: [...customerKeys.all, 'list'] })),
  })
}

/** Downloads the personal data held about one customer as a spreadsheet, named by the server. */
export function useExportCustomerPrivacy() {
  const { $download } = useApi()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: CustomerPrivacyExport }) => {
      const { blob, filename } = await $download(privacyPath(id, 'export'), { method: 'POST', body })
      saveBlob(blob, filename ?? FALLBACK_FILENAME)
    },
  })
}
