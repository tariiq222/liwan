// Query keys of the sales application. Every key starts with `['sales']`; the settings are per company like the
// documents they govern.
export const salesKeys = {
  all: ['sales'] as const,
  list: (params: object) => ['sales', 'list', params] as const,
  detail: (id: number) => ['sales', 'order', id] as const,
  // The public quotation page: the link (id and access token) names the record, there is no company or session.
  quote: (id: number, token: string) => ['sales', 'quote', id, token] as const,
  // The report calls (`summary`, `breakdown`): per filter set, never part of the order lists the writes refetch.
  report: (kind: 'summary' | 'breakdown', params: object) => ['sales', 'report', kind, params] as const,
  settings: (companyId: number | undefined) => ['sales', 'settings', { companyId }] as const,
  // Quotation templates and the sector presets are per company, like the settings.
  templates: (companyId: number | undefined) => ['sales', 'templates', { companyId }] as const,
  templateList: (companyId: number | undefined, params: object) => ['sales', 'templates', { companyId }, 'list', params] as const,
  template: (companyId: number | undefined, id: number) => ['sales', 'templates', { companyId }, 'detail', id] as const,
  presets: (companyId: number | undefined) => ['sales', 'presets', { companyId }] as const,
}
