// Query keys of the customers service. The settings are per company, like the data they describe.
export const customerKeys = {
  all: ['customers'] as const,
  list: (params: object) => ['customers', 'list', params] as const,
  pick: (q: string) => ['customers', 'pick', q] as const,
  detail: (id: number) => ['customers', 'record', id] as const,
  settings: (companyId: number | undefined) => ['customers', 'settings', { companyId }] as const,
}

/** A write changes what the lists and the picker show: both are refetched. */
export const isCustomerListing = (query: { queryKey: readonly unknown[] }) => query.queryKey[1] === 'list' || query.queryKey[1] === 'pick'
