import { useMutation } from '@tanstack/vue-query'
import { opportunityFilters } from '../../utils/crmOpportunity'
import { saveBlob } from '../../utils/saveBlob'

export const CRM_EXPORT_PATH = '/api/v1/crm/export'
const FALLBACK_FILENAME = 'crm-opportunities.csv'

/**
 * The export query of the list's current filters, as the list applies them. The list shows open opportunities when
 * the address names no status, while the export route defaults to every status, so `status` is always sent.
 * Paging and view are not filters and stay out.
 */
export function crmExportQuery(query: Record<string, unknown>): Record<string, string> {
  const { status = 'open', ...filters } = opportunityFilters(query)
  return Object.fromEntries([
    ['status', status],
    ...Object.entries(filters).map(([key, value]) => [key, String(value)]),
  ])
}

/** Downloads the opportunities the list shows as CSV, named by the server. */
export function useCrmExport() {
  const { $download } = useApi()
  return useMutation({
    mutationFn: async (query: Record<string, unknown>) => {
      const { blob, filename } = await $download(CRM_EXPORT_PATH, { query: crmExportQuery(query) })
      saveBlob(blob, filename ?? FALLBACK_FILENAME)
    },
  })
}
