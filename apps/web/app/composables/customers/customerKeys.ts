// Query keys of the customers service. The settings are per company, like the data they describe.
export const customerKeys = {
  all: ['customers'] as const,
  list: (params: object) => ['customers', 'list', params] as const,
  detail: (id: number) => ['customers', 'record', id] as const,
  settings: (companyId: number | undefined) => ['customers', 'settings', { companyId }] as const,
}
