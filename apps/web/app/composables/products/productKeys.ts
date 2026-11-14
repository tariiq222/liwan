// Query keys of the products service. Every key starts with `['products']`, so one invalidation also reaches the pick
// list the applications' pickers read. The settings and the tax choices are per company, like the data they describe.
export const productKeys = {
  all: ['products'] as const,
  list: (params: object) => ['products', 'list', params] as const,
  detail: (id: number) => ['products', 'record', id] as const,
  settings: (companyId: number | undefined) => ['products', 'settings', { companyId }] as const,
  taxes: (companyId: number | undefined) => ['products', 'taxes', { companyId }] as const,
}
