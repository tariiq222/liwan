// Query keys of the sales application. Every key starts with `['sales']`; the settings are per company like the
// documents they govern.
export const salesKeys = {
  all: ['sales'] as const,
  list: (params: object) => ['sales', 'list', params] as const,
  detail: (id: number) => ['sales', 'order', id] as const,
  settings: (companyId: number | undefined) => ['sales', 'settings', { companyId }] as const,
}
