// Query keys of the CRM application. Settings and terms are per company, like the data they describe.
export const crmKeys = {
  all: ['crm'] as const,
  settings: (companyId: number | undefined) => ['crm', 'settings', { companyId }] as const,
  terms: (companyId: number | undefined) => ['crm', 'terms', { companyId }] as const,
  list: (name: CrmListName) => ['crm', 'lists', name] as const,
}

export type CrmListName = 'stages' | 'outcomes' | 'lost-reasons' | 'sources' | 'packages'
