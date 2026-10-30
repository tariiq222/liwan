import { OperationRequestListSchema } from '@liwan/contracts'
import type { AppPersonalEntry } from '../types'

export const operationPersonalEntry: AppPersonalEntry = {
  id: 'operations-personal', section: 'requests', labelKey: 'operations.personal.title', descriptionKey: 'operations.personal.description',
  icon: 'i-lucide-files', to: '/account/requests', capability: 'operations.requests.read',
  primaryAction: { id: 'personal-request-new', to: '/account/requests/new', labelKey: 'operations.personal.new', icon: 'i-lucide-plus', capability: 'operations.requests.create' },
  summary: {
    queryKey: ['operations', 'requests', 'summary'],
    async load(api, t) {
      const result = await api('/api/v1/operations/requests', { query: { scope: 'mine', purpose: 'employee', limit: 3 }, schema: OperationRequestListSchema })
      const rows = result.items.map(record => ({ id: record.id, label: record.name, caption: t(`operations.states.${record.state}`), to: `/account/requests/${record.id}` }))
      return { value: String(result.total), caption: t('operations.personal.description'), rows,
        attention: result.items.filter(record => record.state === 'returned').map(record => ({ id: `own-request-${record.id}`, label: record.name, caption: t('operations.personal.returned'), to: `/account/requests/${record.id}`, tone: 'urgent' as const })),
      }
    },
  },
}
