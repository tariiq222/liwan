import { operationListLocation } from './forms'
import type { OperationScope } from './useOperations'

// The heading and the create link of an operations list page. The pages own the SharedListPage shell; RequestList and
// ProcessList draw the card in it. The create link carries the list's filters as its returnTo.
export function useRequestListPage(scope: OperationScope) {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const path = scope === 'mine' ? '/operations' : `/operations/${scope}`
  const createTo = computed(() => can('operations.requests.create') ? { path: '/operations/new', query: { returnTo: operationListLocation(path, route.query, route.hash) } } : undefined)
  return { title: t(`operations.nav.${scope}`), createTo, createLabel: t('operations.newRequest') }
}

export function useProcessListPage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const createTo = computed(() => can('operations.processes.manage') ? { path: '/operations/processes/new', query: { returnTo: operationListLocation('/operations/processes', route.query, route.hash) } } : undefined)
  return { title: t('operations.nav.processes'), createTo, createLabel: t('operations.newProcess') }
}
