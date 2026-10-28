// Query keys of the CRM application. Settings and terms are per company, like the data they describe.
export const crmKeys = {
  all: ['crm'] as const,
  settings: (companyId: number | undefined) => ['crm', 'settings', { companyId }] as const,
  terms: (companyId: number | undefined) => ['crm', 'terms', { companyId }] as const,
  list: (name: CrmListName) => ['crm', 'lists', name] as const,
  choices: (name: CrmListName) => ['crm', 'choices', name] as const,
  opportunities: ['crm', 'opportunities'] as const,
  opportunityList: (params: object) => ['crm', 'opportunities', 'list', params] as const,
  opportunity: (id: number) => ['crm', 'opportunities', 'record', id] as const,
  calls: (id: number) => ['crm', 'opportunities', 'calls', id] as const,
  importBatches: (params: object) => ['crm', 'imports', 'batches', params] as const,
  importBatchesAll: ['crm', 'imports', 'batches'] as const,
  importMappings: ['crm', 'imports', 'mappings'] as const,
  dashboardAll: ['crm', 'dashboard'] as const,
  dashboard: (companyId: number | undefined) => ['crm', 'dashboard', { companyId }] as const,
}

export type CrmListName = 'stages' | 'outcomes' | 'lost-reasons' | 'sources' | 'packages'
